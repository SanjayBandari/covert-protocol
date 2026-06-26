# COVERT PROTOCOL — Operation Silent Dawn

An original, open-source **tactical stealth FPS prototype** that runs entirely in the
browser. Infiltrate a fortified depot at night, slip past patrols and sweeping
searchlights, plant a demolition charge on the comms tower, and escape to the
extraction beacon.

Built with [Three.js](https://threejs.org/) — no build step, no installed
dependencies, no binary assets. Every texture and sound effect is generated
procedurally at runtime.

> This is an original work inspired by the classic late-90s/early-2000s tactical
> shooter genre. It contains no assets, code, names, or content from any
> commercial game.

## Play it locally

ES modules require an HTTP server (opening `index.html` from disk won't work):

```bash
# any one of these, from the project root:
npx serve .
python -m http.server 8080
php -S localhost:8080
```

Then open `http://localhost:8080` (or whatever port your server prints).

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Source**: select `main` branch, root folder.
3. Your game is live at `https://<user>.github.io/<repo>/`.

It's plain static files, so Netlify / Vercel / Cloudflare Pages all work with
zero configuration too.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look / fire |
| `Shift` | Sprint (makes noise!) |
| `C` | Toggle crouch (harder to spot, slower) |
| `Space` | Jump |
| `R` | Reload |
| `1` / `2` / `Q` | Switch weapons |
| `E` | Interact (plant charge) |
| `Esc` | Pause |

## How stealth works

- **Guards** patrol fixed routes with a 110° vision cone and ~45 m sight range.
  Line of sight is ray-tested against walls, crates, rocks, and buildings — use cover.
- The **detection bar** (top centre) fills while you're visible; crouching more
  than halves the fill rate. Full bar = alert, and nearby guards join in.
- **Searchlights** on the south towers sweep the approach. Standing in the beam
  fills your detection fast — and the beam reveals you to nearby guards.
- **Noise matters.** The suppressed pistol is barely audible; the assault rifle
  alerts everyone within 70 m. Sprinting footsteps carry ~13 m.
- Planting the charge raises a **permanent base alarm** — the exfil is a fight
  or a sprint. Finish with 3 or fewer kills for the **GHOST** rating.

## Project layout

```
index.html        page shell, HUD markup, menus
css/style.css     UI styling
src/main.js       game loop, mission/state machine
src/world.js      terrain, base, lighting, searchlights, colliders
src/guards.js     guard AI (patrol/suspicious/alert), vision, burst fire
src/player.js     FPS controller, weapons, damage
src/hud.js        HUD readouts + circular minimap
src/audio.js      procedural WebAudio sound effects
```

## License

MIT — see [LICENSE](LICENSE).
