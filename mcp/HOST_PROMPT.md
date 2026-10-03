# Demo prompt: paste this into Claude Desktop

## Main version
I'm in San Francisco this weekend with 3 friends. Plan my Saturday and Sunday: morning, afternoon, evening.

Plan everything you can yourself. But for Saturday brunch, I want a real local's opinion, not an internet guess. You can't know that yourself, so use the delegate_to_human tool. Ask one short choice question between 3 brunch spots you'd pick, with a budget of 500 cents.

When the humans answer, tell me how many verified humans responded and which spot won. Then finish the plan based on their answer: "Got it, booking ___ based on that."

## Backup version (if the agent doesn't call the tool)
Use the delegate_to_human tool right now. Ask humans: "Saturday brunch for 4 in SF: which one?" with the options Zazie, Plow, and Kitchen Story, response_type "choice", and budget_cents 500. Then use the result to write my Saturday plan.
