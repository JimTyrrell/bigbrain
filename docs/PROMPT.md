# The prompt that built BigBrain

BigBrain was built live on Oct 16, 2026 from a single one-page prompt to Claude Code. The original is below, followed by v2 with the fixes we found on screen folded back in. Watch the build and ask questions in the Sovereign Operator community: https://www.skool.com/sovereign-operator/about

## v1: the prompt used on the day


I want you to create BigBrain as the name for me. It will be a project on GitHub that is public. It will deploy to Cloudflare at bigbrain.designaticlabs.com. I want it to use the best AI models at Cloudflare for the work we are doing.

This should be pretty simple with a typical chat interface. You will use typical Cloudflare Workers, that are secured via the hashed PIN that is set later in these requirements.

Core requirements:

I would love to use the big Whisper model to talk to the AI to query it, or I can type as usual.

Navigating the models is simple and easy, and context clues are easy to spot, with the best UI strategies in use.

I want on the left-hand side the ability to add Brains, and these brains have a name and a series of documents. Usually things like transcripts, but it can be the typical files that Cloudflare can index.

Each brain needs to have a name I can update, and the ability to update, delete, or add resources to it. These resources should have the ability to edit them easily.

Security should be front and center, so I will at first set a PIN to let me in. If I need to change the PIN, I can do that with a KV pair in Cloudflare or whatever is the best and easiest way to do that in the web UI.

No command-line magic is required to get this going.

You save conversations, but I can also easily delete them if I want.

Please analyse these requirements and help me refine them a bit.

Feel free to use the GitHub project URL and wire it up to Cloudflare so that updates to GitHub work right away. Also, please use a local copy of GitHub on this project, as this project is in Google Drive and GitHub doesn't work great on Google Drive.

When setting this up, please let me select the AI model that is being used, but by default I think it is the Llama 4 model that is available with 70B things, right?

Finally let's seed up 2 big brains with content from these two YT creators:

Alex Hormozi
https://www.youtube.com/watch?v=eq1bnI0JoXU
https://youtu.be/B-ogfFiQpXg
https://www.youtube.com/watch?v=8VqSFBMMS4M
https://www.youtube.com/watch?v=j2TZMFkj71Q

Dan Harrison
https://youtu.be/B85So_sK700
https://youtu.be/_ZyGdvEAQV4
https://youtu.be/_bZbIweW8M4
https://youtu.be/GCYFth_mTmU
https://youtu.be/8kKu9Mw4MEU

When I query for insights, I want you to quote the person directly and not make up anything. You are welcome to use your wider set of knowledge, but it must be attributable to the person or someone adjacent to their skills.

When you are done with the requirements, please spin up agents to do the different parts of this with Opus.

Please create a Fable validator that checks all of this is working well, all things are wired up, and it works before you ask me to check it out.


## v2: with what we learned


I want you to create BigBrain as the name for me. It will be a public project on GitHub at github.com/JimTyrrell/bigbrain, with a local clone in ~/Projects/bigbrain (not in Google Drive; git does not behave there). It will deploy to Cloudflare at bigbrain.designaticlabs.com. Use the best AI models Cloudflare Workers AI has for the work we are doing. No third-party AI keys.

This should be pretty simple with a typical chat interface, built on typical Cloudflare Workers (Workers AI, D1, Vectorize, KV, static assets), secured by the hashed PIN described below.

Core requirements:

Voice. I want to talk to it with the biggest Whisper model Cloudflare offers (whisper-large-v3-turbo), or type as usual. Push-to-talk on a mic button. Handle the browser's first-time microphone permission prompt: if I let go of the button to click "Allow", switch to click-to-stop instead of recording nothing. Show the real server error if transcription fails, never a generic message.

Models. Let me pick the model from a picker in the chat header, with a plain name, context size, a "best for" note, and how long it takes to answer. Default to Llama 4 Scout. (Cloudflare's Llama 4 is Scout, 17B active, not a 70B; offer Llama 3.3 70B separately.) Include GPT-OSS 120B, DeepSeek V4 Pro, Kimi K2.6, Gemma 4 and Qwen too, and mark which ones quote verbatim most reliably. Remember the model per conversation and show it under every answer. Show a "Thinking" state with a timer while slow models warm up.

Brains. On the left-hand side, let me add Brains. A brain has a name I can edit, a one-line description, and a set of documents, usually transcripts, but any file Cloudflare can convert (PDF, Word, slides, spreadsheets, HTML, images, text, VTT). Store every document as editable Markdown. Let me add, edit, re-index and delete documents easily. Keep timestamps in transcripts so answers can link to the exact moment in the video. Show when a document is indexed and, separately, when Vectorize has actually made it searchable; that takes a minute or two and must not look broken.

Security front and center. On my first visit, ask me to set a PIN (6 to 12 digits). Store only a salted PBKDF2 hash in KV. Signed HttpOnly session cookie, lockout after 5 bad tries, change PIN from Settings. If I forget the PIN, the fix is deleting the pin_hash and session_secret keys in KV, not the namespace, so put a "Forgot your PIN?" guide on the lock screen itself with numbered steps, an illustration, and a direct link to that KV namespace in the Cloudflare dashboard. Strict security headers on the app and the API.

No command-line magic is required to get this going. The first visit sets the PIN. Nothing else to configure by hand.

Save conversations per brain, auto-title them, and let me rename, delete one, or delete all.

Quoting rule. When I ask for insights, quote the person directly and never make anything up. Every quote verbatim, copied from a single passage, with a numbered citation that links to the video at that timestamp. Structure answers as "What {name} said", then an optional "Adjacent insight" that is clearly labelled as not from the source and attributed to the kind of practitioner it comes from. If my question is about a situation the material does not name (my niche, my role, my product), do not say nothing was found: quote the principles that apply and add an "Applied to your situation" section in your own words. Only say the material does not cover it when nothing is related at all.

Seed two brains from these YouTube creators, fetching the transcripts locally with yt-dlp. Do not commit the transcript text to the public repo; commit only the list of videos and a seed script. After seeding, clear the temporary PIN so my first visit asks me to set my own.

Alex Hormozi
https://www.youtube.com/watch?v=eq1bnI0JoXU
https://youtu.be/B-ogfFiQpXg
https://www.youtube.com/watch?v=8VqSFBMMS4M
https://www.youtube.com/watch?v=j2TZMFkj71Q

Dan Harrison
https://youtu.be/B85So_sK700
https://youtu.be/_ZyGdvEAQV4
https://youtu.be/_bZbIweW8M4
https://youtu.be/GCYFth_mTmU
https://youtu.be/8kKu9Mw4MEU

Deploying. Make the wrangler config work for anyone who clicks a Deploy to Cloudflare button: resource names only, no account id, no routes in the config (attach my custom domain on the Worker instead), migrations by binding name. Put the deploy button in the README. Wire the GitHub repo to Cloudflare Workers Builds so pushes to main deploy automatically. Create the repo and push; if you need me to sign in to GitHub, tell me once, early.

Licence. PolyForm Shield 1.0.0, with a plain-English NOTICE.md FAQ and a one-line licence summary at the top of the README. Same as my other workshop repos.

Process. First analyse these requirements and refine them into a numbered list I can check against. Then spin up agents to build the different parts in parallel with Opus: backend, web app, seed tooling. Then create a Fable validator that checks every numbered requirement on the live site (auth, brains, documents, indexing, chat with a verbatim-quote check, model switching, Whisper, lockout, security headers) and fix what it finds, before you ask me to check it out. Clear any login lockout you caused.


## What changed from v1, and why

- Llama 4 on Workers AI is Scout, not a 70B. v1 guessed wrong; v2 names the right default and keeps the 70B as an option.
- Voice failed on first use because the mic permission prompt swallowed the button press. v2 says how to handle it.
- The PIN reset was documented in Settings, which you cannot reach when locked out. v2 puts it on the lock screen and warns to delete keys, not the namespace.
- Documents said "indexed" a minute or two before they were searchable. v2 asks for both states.
- A question about a specific situation ("best offer for a Fractional CTO") came back as "nothing found". v2 adds the "Applied to your situation" rule.
- The one-click deploy needs a config without account ids or routes. v2 asks for that up front.
- Transcripts of other creators stay out of the public repo. v2 makes that explicit.
- Licence and the GitHub sign-in are asked for up front instead of discovered at the end.
