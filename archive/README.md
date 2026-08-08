# archive/

Files kept here for safekeeping only. **Nothing in this folder is built, served or
published** — `build.mjs` never reads it and it does not reach `dist/`.

## locker-templates.html

The Locker training templates: Daily Session, 4-Week Block, Game-Day Fuel, Recipe, and
The Midnight Set, with a print stylesheet that flips the brand tokens to paper.

It is here because it was the one piece of original work in this project that existed
in a single unversioned copy. An archive sweep confirmed its training copy — "The Daily
Sixty", "Warm the engine", "Handle under pressure", "Finish through contact",
"Shooting, in makes", "Close it out", "Retest scorecard" — appears in **no** other file
in the project, has never shipped on the site, and lived only at the project root, which
is not a git repository.

That is precisely how ~46KB of shipped source (fb-polish.css, night-court.js, theme.js)
came within one deleted folder of being lost. One copy in an unversioned directory is
not storage, it is luck.

The original stays where it is. This is the durable copy.

There is a sibling at the project root, `Locker Templates.html` (111KB), which is the
same design unbundled. It is NOT copied here: it references `./support.js` and a `_ds/`
folder that do not exist, so it cannot render, and its content is identical to this one.
