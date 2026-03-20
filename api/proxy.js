export default async function handler(req, res) {
  // Обробка preflight OPTIONS (браузер завжди шле це перед не-simple запитами)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // Беремо цільовий URL з шляху після першого слеша
  const targetPath = req.url.slice(1);

  if (!targetPath) {
    return res.status(400).json({ error: 'No target URL. Use /https://api.music.yandex.net/...' });
  }

  let targetUrl = targetPath.startsWith('http') ? targetPath : 'https://' + targetPath;

  // Обмеження на Yandex Music (безпека)
  if (!targetUrl.includes('api.music.yandex.net') && !targetUrl.includes('music.yandex.net')) {
    return res.status(403).json({ error: 'Only Yandex Music API allowed' });
  }

  const fetchHeaders = { ...req.headers };
  delete fetchHeaders.host;
  delete fetchHeaders.connection;
  delete fetchHeaders['content-length'];

  try {
    const proxyResponse = await fetch(targetUrl, {
      method: req.method,
      headers: fetchHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
      redirect: 'follow'
    });

    // Копіюємо всі заголовки від Yandex
    proxyResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Перезаписуємо CORS (обов'язково!)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');

    res.status(proxyResponse.status);

    const data = await proxyResponse.arrayBuffer();
    res.end(Buffer.from(data));

  } catch (error) {
    console.error(error);
    res.status(502).json({ error: 'Proxy failed: ' + error.message });
  }
}
