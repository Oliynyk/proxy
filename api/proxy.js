// api/proxy.js (або api/index.js)

export default async function handler(req, res) {
  // 1. Обробка CORS preflight (OPTIONS) — обов'язково для браузера
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // 2. Витягуємо цільовий URL з шляху після першого слеша
  const targetPath = req.url.slice(1); // наприклад: https://api.music.yandex.net/...

  if (!targetPath) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({
      error: 'No target URL provided. Example: /https://api.music.yandex.net/account/status?...'
    });
  }

  let targetUrlStr = targetPath.startsWith('http') ? targetPath : 'https://' + targetPath;

  // 3. Обмеження: тільки Yandex Music домени
  if (!targetUrlStr.includes('api.music.yandex.net') && !targetUrlStr.includes('music.yandex.net')) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(403).json({ error: 'Only Yandex Music API domains allowed' });
  }

  // 4. Копіюємо заголовки від клієнта, але видаляємо небезпечні/непотрібні
  const fetchHeaders = { ...req.headers };
  delete fetchHeaders.host;
  delete fetchHeaders.connection;
  delete fetchHeaders['content-length'];
  delete fetchHeaders['transfer-encoding'];
  delete fetchHeaders.origin;
  delete fetchHeaders.referer;
  
  // ВИДАЛЯЄМО IP-заголовки, які показують Яндексу реальну країну користувача (Україну)
  // Через них Яндекс блокує запит 451 (Unavailable For Legal Reasons)
  delete fetchHeaders['x-forwarded-for'];
  delete fetchHeaders['x-real-ip'];
  delete fetchHeaders['x-vercel-forwarded-for'];
  delete fetchHeaders['forwarded'];
  delete fetchHeaders['via'];

  // Явно забороняємо стиснення з боку Yandex, щоб уникнути ERR_CONTENT_DECODING_FAILED
  fetchHeaders['Accept-Encoding'] = 'identity';

  try {
    console.log(`[Proxy] Request to: ${targetUrlStr}`);
    console.log(`[Proxy] Method: ${req.method}`);

    const proxyResponse = await fetch(targetUrlStr, {
      method: req.method,
      headers: fetchHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
      redirect: 'follow'
    });

    console.log(`[Proxy] Response status from Yandex: ${proxyResponse.status}`);

    // Копіюємо всі заголовки від Yandex
    proxyResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Обов'язково перезаписуємо CORS-заголовки (Vercel іноді їх з'їдає)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Вимикаємо будь-яке стиснення з нашого боку
    res.removeHeader('Content-Encoding');
    res.setHeader('Content-Encoding', 'identity');

    // Встановлюємо статус і відправляємо тіло
    res.status(proxyResponse.status);

    const arrayBuffer = await proxyResponse.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));

  } catch (error) {
    console.error('[Proxy Error]', error.message);
    res.setHeader('Content-Type', 'application/json');
    res.status(502).json({
      error: 'Proxy fetch failed',
      message: error.message
    });
  }
}
