# Submission checklist (deadline: Sep 4, 2026, 1:00 am PT = 11:00 IDT)

Everything below except step 0 is a human step on Itamar's side. Anton has prepared all the text.

0. (Anton) Final deploy done, E2E green against the live URL, video rendered → `builds/agentpdp-video/out/agentpdp-demo.mp4` + `out/youtube.txt`.
1. **DNS (optional but nicer for judges):** add `A <hostname> → 188.166.163.33` (e.g. `pdp.aigency.ai`). Then Anton runs `scripts/set-host.sh <hostname> --set-origin` and updates the URLs in README/DEVPOST. If DNS is not ready by ~10:15 IDT, submit with the sslip.io URL; it is valid and has a real certificate.
2. **ChatGPT check on the Air (5 min):** ChatGPT desktop → Work or Codex chat → Cmd+Shift+B → open the live URL → click the Brooklinen chip → confirm the site-tools arrow in the address bar → ask "which sizes are in stock under $200, add the queen to my cart" → approve on the page. If the arrow does not appear, check Browser settings → Permissions → Enable site tools, and that the model is GPT-5.6 Sol or Terra.
3. **YouTube:** upload `agentpdp-demo.mp4` as Public (not Unlisted: the rules say public). Title + description in `out/youtube.txt`. Copy the link.
4. **Devpost:** webmcp.devpost.com → Join hackathon (if not yet) → Submit a project. Paste from `docs/DEVPOST.md`: project name, tagline, description sections, "Built with", live URL, repo URL, video URL, testing instructions. Team: Aigency. Confirm the open-source license (MIT) and that the repo is public.
5. **Submit before 11:00 IDT.** Devpost locks edits after the deadline.
6. After submitting: paste the Devpost project URL in #amy-anton; Anton archives everything and writes the LinkedIn post draft.
