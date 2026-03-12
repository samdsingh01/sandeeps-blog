# Author Photos

## How to add your real photo

Copy your profile photo here and name it:
```
sandeep.jpg
```

Full path: `blog/public/images/author/sandeep.jpg`

This will automatically appear in:
- All author bio sections (bottom of every blog post)
- The About page (large circular photo)
- Blog card author rows

## Requirements
- **Format:** JPG or PNG
- **Size:** At least 400×400px (square crops best)
- **Tip:** Use a headshot where your face is clearly visible and centered

## Files in this directory

| File | Purpose |
|------|---------|
| `sandeep.jpg` | ← **Your real photo goes here** |
| `sandeep-placeholder.svg` | Illustrated avatar fallback (auto-used if jpg missing) |
| `sandeep-working.png` | AI-generated scene: working at laptop (via Gemini) |
| `sandeep-speaking.png` | AI-generated scene: speaking at conference (via Gemini) |
| `sandeep-presenting.png` | AI-generated scene: presenting to team (via Gemini) |
| `sandeep-casual.png` | AI-generated scene: casual workspace shot (via Gemini) |
| `sandeep-thumbnail.png` | AI-generated scene: YouTube thumbnail style (via Gemini) |

## Generate AI contextual images
The agent can generate contextual images of you (Sandeep) using Gemini Imagen 3,
guided by your physical description stored in `image_generator.py`:

```bash
cd agent
python main.py --author-images
```

These are professional editorial-style illustrations — useful for:
- Featured article hero images
- LinkedIn posts
- Presentation backgrounds
- Email headers

## LinkedIn Profile
https://www.linkedin.com/in/samdsingh/
