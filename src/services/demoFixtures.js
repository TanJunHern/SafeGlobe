/**
 * The demo page a crawler agent reads: a fictional port authority notice board served by the app itself at
 * /demo/port-notices. It has two versions, so the demo can show a page changing without depending on anyone
 * else's website. Everything on it is invented and the page says so.
 */
const PATH = '/demo/port-notices';
const SOURCE_ID = 's_demo_port_notices';
const SOURCE_LABEL = 'Straits Port Authority notices (demo page)';
const SETTING = 'demo_fixture_port_notices_version';

const NOTICES = [
  { version: 1, date: '2 Oct 2026', title: 'Notice 2026-41: Berth maintenance', body: 'Meridian Port Logistics Pte Ltd is the appointed contractor for berths 4 and 5 at the eastern terminal, which are closed for fender replacement until 20 October.' },
  { version: 1, date: '5 Oct 2026', title: 'Notice 2026-42: Pilotage hours', body: 'Night pilotage in the eastern anchorage is suspended on 14 and 15 October for hydrographic survey work.' },
  { version: 2, date: '11 Oct 2026', title: 'Notice 2026-43: Inquiry opened', body: 'The tanker Aurora Venture (IMO 9304124), flying the flag of Cameroon, was observed in a ship-to-ship transfer east of Johor on 9 October after 31 hours without an AIS signal. The authority has opened an inquiry and asked for the voyage records.' }
];

const versionOf = db => (Number(db.getSetting(SETTING, 1)) === 2 ? 2 : 1);

function setVersion(db, version) {
  return db.setSetting(SETTING, Number(version) === 2 ? 2 : 1);
}

/** The page as HTML for one of this app's own paths, or null when the path is not a demo page. */
function render(db, pathname) {
  if (pathname !== PATH) return null;
  const version = versionOf(db);
  const items = NOTICES.filter(n => n.version <= version).reverse()
    .map(n => `<article><h2>${n.title}</h2><p>${n.body}</p><p class="date">Published on ${n.date}.</p></article>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Straits Port Authority notices (demo)</title>
<meta name="robots" content="noindex">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;color:#1c2733}.demo{background:#fff4d6;border:1px solid #e0b94a;padding:8px 12px;border-radius:6px}article{border-top:1px solid #d8dee4;padding:12px 0}.date{color:#5b6b7a;margin:0}h2{font-size:18px;margin:0}</style></head>
<body>
<p class="demo">Demo page: fictional. The Straits Port Authority, every notice, every organisation and every ship named here is invented for the DueDilly demo.</p>
<h1>Straits Port Authority: notices to mariners</h1>
${items}
</body></html>`;
}

module.exports = { PATH, SOURCE_ID, SOURCE_LABEL, render, versionOf, setVersion };
