// Close every open task so phones and the board start clean.
// Run: BASE_URL=https://dryrun-oct3-oct2.vercel.app npm run reset
const BASE_URL = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");

const tasks = await (await fetch(`${BASE_URL}/api/tasks?status=open`)).json();
if (!tasks.length) console.log("Nothing open. Clean slate.");
for (const t of tasks) {
  await fetch(`${BASE_URL}/api/tasks/${t.id}/close`, { method: "POST" });
  console.log("closed:", t.prompt);
}
