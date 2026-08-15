module.exports = (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
};
