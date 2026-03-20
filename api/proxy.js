// api/proxy.js
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Vercel CORS proxy for Yandex Music API
 * 
 * Підтримує роботу через upstream проксі для обходу гео-блокувань Яндекса.
 * 
 * Щоб використати upstream проксі, додайте змінну оточення у Vercel:
 *   UPSTREAM_PROXY=http://1.2.3.4:8080    (для HTTP/HTTPS проксі)
 *   UPSTREAM_PROXY=socks5://1.2.3.4:1080  (для SOCKS5 проксі)
 * 
 * Якщо змінна не задана — Vercel ходить напряму (поточна поведінка).
 */
export default async function handler(req, res) {
  // 1. Обробка CORS preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  // 2. Витягуємо цільовий URL з шляху після першого слеша
  const targetPath = req.url.slice(1);

  if (!targetPath) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({
      error: 'No target URL provided. Example: /https://api.music.yandex.net/account/status'
    });
  }

  let targetUrlStr = targetPath.startsWith('http') ? targetPath : 'https://' + targetPath;
  
  // Виправляємо подвійний слеш (https://... -> https://...)
  targetUrlStr = targetUrlStr.replace(/^(https?:\/)([^/])/, '$1/$2');

  // 3. Обмеження: тільки Yandex домени
  const allowedDomains = ['api.music.yandex.net', 'music.yandex.net', 'avatars.yandex.net', 'avatars.mds.yandex.net'];
  if (!allowedDomains.some(d => targetUrlStr.includes(d))) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(403).json({ error: 'Only Yandex Music API domains allowed' });
  }

  // 4. Копіюємо заголовки від клієнта, але видаляємо небезпечні
  const fetchHeaders = { ...req.headers };
  delete fetchHeaders.host;
  delete fetchHeaders.connection;
  delete fetchHeaders['content-length'];
  delete fetchHeaders['transfer-encoding'];
  delete fetchHeaders.origin;
  delete fetchHeaders.referer;
  // Видаляємо IP-заголовки, що показують Яндексу реальну IP-країну
  delete fetchHeaders['x-forwarded-for'];
  delete fetchHeaders['x-real-ip'];
  delete fetchHeaders['x-vercel-forwarded-for'];
  delete fetchHeaders['forwarded'];
  delete fetchHeaders['via'];

  // Забороняємо стиснення, щоб уникнути ERR_CONTENT_DECODING_FAILED
  fetchHeaders['Accept-Encoding'] = 'identity';

  // 5. Визначаємо, чи потрібен upstream проксі
  const upstreamProxy = process.env.UPSTREAM_PROXY;
  let fetchOptions = {
    method: req.method,
    headers: fetchHeaders,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
    redirect: 'follow',
  };

  if (upstreamProxy) {
    console.log(`[Proxy] Using upstream proxy: ${upstreamProxy}`);
    
    // Вибираємо агент відповідно до типу проксі
    const agent = upstreamProxy.startsWith('socks')
      ? new SocksProxyAgent(upstreamProxy)
      : new HttpsProxyAgent(upstreamProxy);
    
    // @ts-ignore — fetch() в Node 18/20 підтримує опцію dispatcher через undici,
    // але https-proxy-agent використовує 'agent', що сумісно з node-fetch
    fetchOptions.agent = agent;
  } else {
    console.log(`[Proxy] Direct request (no upstream proxy configured)`);
  }

  try {
    console.log(`[Proxy] --> ${req.method} ${targetUrlStr}`);
    const proxyResponse = await fetch(targetUrlStr, fetchOptions);
    console.log(`[Proxy] <-- ${proxyResponse.status} from Yandex`);

    // Копіюємо заголовки від Yandex
    proxyResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    // Обов'язково перезаписуємо CORS-заголовки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

    // Вимикаємо стиснення з нашого боку
    res.removeHeader('Content-Encoding');
    res.setHeader('Content-Encoding', 'identity');

    res.status(proxyResponse.status);
    const arrayBuffer = await proxyResponse.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));

  } catch (error) {
    console.error('[Proxy Error]', error.message);
    res.setHeader('Content-Type', 'application/json');
    res.status(502).json({
      error: 'Proxy fetch failed',
      message: error.message,
      upstream: upstreamProxy || 'none (direct)'
    });
  }
}
