// GET /upload — volunteer photo-upload page, served as a Pages Function so it stays
// out of the static build and is shared by every tenant. Must sit behind the same
// Cloudflare Access application as /api/* (see PROPOSAL_PHOTO_UPLOADS.md).

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Upload Photos</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 34rem; margin: 2rem auto; padding: 0 1rem; }
  label { display: block; margin: 1rem 0 0.25rem; font-weight: 600; }
  select, input[type=text] { width: 100%; padding: 0.5rem; font-size: 1rem; }
  input[type=file] { margin-top: 0.5rem; }
  button { margin-top: 1.25rem; padding: 0.6rem 1.5rem; font-size: 1rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  #status li { margin: 0.25rem 0; }
  .ok { color: #1a7f37; }
  .err { color: #b42318; }
  .hint { color: #666; font-size: 0.85rem; margin-top: 0.25rem; }
</style>
</head>
<body>
<h1>Upload Photos</h1>
<p>Photos land in the club gallery after the next site refresh.</p>

<label for="event">Event</label>
<select id="event"></select>
<input id="new-event" type="text" placeholder="new-event-slug (lowercase-with-dashes)" hidden />
<p class="hint">Pick the meet or social these photos are from.</p>

<label for="caption">Caption (optional, applied to all selected photos)</label>
<input id="caption" type="text" maxlength="300" />

<label for="files">Photos</label>
<input id="files" type="file" accept="image/*" multiple />

<button id="go" disabled>Upload</button>
<ul id="status"></ul>

<script>
const $ = (s) => document.querySelector(s);
const eventSel = $("#event"), newEvent = $("#new-event"), files = $("#files"), go = $("#go");

async function loadEvents() {
  try {
    const res = await fetch("/gallery/index.json");
    const data = await res.json();
    for (const e of data.events ?? []) {
      const opt = new Option(e.name + (e.date ? " (" + e.date + ")" : ""), e.slug);
      eventSel.add(opt);
    }
  } catch {}
  eventSel.add(new Option("Other / new event…", "__new__"));
}
loadEvents();

eventSel.addEventListener("change", () => {
  newEvent.hidden = eventSel.value !== "__new__";
});
files.addEventListener("change", () => { go.disabled = !files.files.length; });

function report(name, ok, msg) {
  const li = document.createElement("li");
  li.className = ok ? "ok" : "err";
  li.textContent = name + " — " + msg;
  $("#status").appendChild(li);
}

go.addEventListener("click", async () => {
  const event = eventSel.value === "__new__" ? newEvent.value.trim() : eventSel.value;
  if (!event) { report("event", false, "pick or name an event first"); return; }
  go.disabled = true;
  for (const file of files.files) {
    try {
      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event, caption: $("#caption").value }),
      });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || "upload-url failed");
      const form = new FormData();
      form.set("file", file);
      const up = await fetch(urlData.uploadURL, { method: "POST", body: form });
      if (!up.ok) throw new Error("upload failed (" + up.status + ")");
      report(file.name, true, "uploaded");
    } catch (err) {
      report(file.name, false, err.message);
    }
  }
  go.disabled = false;
});
</script>
</body>
</html>`;

export async function onRequestGet(): Promise<Response> {
  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
}
