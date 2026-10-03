// Pretend to be humans: answers every open task with a few fake responses.
// Run: npm run bots            (uses BASE_URL, default http://localhost:4000)
const BASE_URL = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const answered = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pool = ["Maya", "Jordan", "Priya", "Sam", "Diego", "Aisha", "Kenji", "Leah", "Omar", "Tess", "Ravi", "Nina"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const texts = ["Go with the first one, it's the most relaxed vibe.", "The first one, great brunch and easy parking.", "Second one if you want something livelier."];

console.log("Bots watching", BASE_URL);
while (true) {
  try {
    const tasks = await (await fetch(`${BASE_URL}/api/tasks`)).json();
    for (const t of tasks.filter((t) => t.status === "open" && t.response_type !== "live" && !answered.has(t.id))) {
      answered.add(t.id);
      console.log("Answering task", t.id, "-", t.prompt);
      (async () => {
        const names = [...pool].sort(() => Math.random() - 0.5);
        for (let i = 0; i < 3; i++) {
          await sleep(2000 + Math.random() * 3000);
          const answer = t.response_type === "choice" && t.options?.length ? pick(t.options) : pick(texts);
          await fetch(`${BASE_URL}/api/tasks/${t.id}/responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer, name: names[i] }) });
          console.log("  ", names[i], "->", answer);
        }
      })();
    }
  } catch (e) { console.log("waiting for backend...", e.message); }
  await sleep(1500);
}
