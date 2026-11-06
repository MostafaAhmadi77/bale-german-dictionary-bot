export default function handler(req, res) {
  res.status(200).json({ ok: true, service: 'bale-german-dictionary-bot', time: new Date().toISOString() });
}
