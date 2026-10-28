# Code review rules

## TypeScript

- Validate a category, radius, and id before the query reaches SQL.
- Keep the spatial rules in the existing SQL functions.
- The Huff model is potential consumption. Do not describe it as revenue.

## Python

- The static grid uses the same bounds as `generate_vm_grid()`.
- Do not add a Google Maps scraper.

## General

- Do not commit secrets, raw downloads, or shapefiles.
- API error messages stay in Spanish, matching the routes that already exist.
