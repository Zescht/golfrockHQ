# GolfRock Headquarter quizzes

Static bilingual map quizzes published through GitHub Pages.

- Porsche Centre: `/porsche/?lang=en` or `/porsche/?lang=de`
- Italian Regions: `/italian-regions/?lang=en` or `/italian-regions/?lang=de`
- Randomly Merged US States: `/randomly-merged-us-states/?lang=en`
- Largest Opera Houses: `/largest-opera-houses/?lang=en` or `/largest-opera-houses/?lang=de`
- Oldest Opera Houses: `/oldest-opera-houses/?lang=en` or `/oldest-opera-houses/?lang=de`

The root page redirects to the Porsche quiz and preserves the selected language.

## Project structure

- `porsche/` contains the complete Porsche Centre quiz, including its scripts, styles, answer data, and map assets.
- `italian-regions/` contains the complete Italian Regions quiz, including its scripts, styles, answer data, and map assets.
- `randomly-merged-us-states/` contains the complete English Randomly Merged US States quiz and its generated contiguous-state map data.
- `largest-opera-houses/` contains the bilingual fixed-seating-capacity opera-house quiz.
- `oldest-opera-houses/` contains the bilingual historic operating-opera-house quiz.
- The repository root contains only the redirecting landing page and project-level files.

## Data sources

- Porsche quiz answers: project-maintained official Porsche location workbook export.
- World boundaries and relief: Natural Earth.
- Italian regional boundaries: ISTAT-derived data distributed by [`guglielmo/geojson-italy`](https://github.com/guglielmo/geojson-italy) under CC BY 4.0.
- Contiguous US state boundaries: U.S. Census Bureau 2025 Cartographic Boundary Files.
- Opera-house capacity and opening-year answers: official venue, operator, government, and UNESCO sources documented during project research.
