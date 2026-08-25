# Personal Website

The source code for [lukastbecker.com](https://lukastbecker.com), a simple personal website built with [Astro](https://astro.build/).

The site act as a starter project to hold any future web development projects I plan to do. 

## Getting started

You will need [Node.js](https://nodejs.org/) 22.12 or newer.

Install the dependencies:

```sh
npm install
```

Start the local development server:

```sh
npm run dev
```

Then open [http://localhost:4321](http://localhost:4321) in a browser. Astro automatically refreshes the page when a source file changes.

## Editing the site

The homepage is located at:

```text
src/pages/index.astro
```

This file contains:

- Page metadata, including the title and description
- The header and home navigation item
- Introduction, Work, About, and Contact sections
- All site styles and responsive behavior

Static files such as favicons belong in the `public/` directory.

## Available commands

Run each command from the project directory.

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the local development server |
| `npm run build` | Creates a production build in `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run astro -- --help` | Shows the Astro command-line help |

## Project structure

```text
.
├── public/
│   └── favicon.svg
├── src/
│   └── pages/
│       └── index.astro
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

## Deployment

The site is currently hosted on Cloudflare at [lukastbecker.com](https://lukastbecker.com). 
Recommended Cloudflare build settings:

Build command - `npm run build` 
Build output directory - `dist` 
Node.js version - 22.12 or newer 

Check the Cloudflare project settings before pushing if you are unsure which branch is configured for production.

## License

This is a personal website. Unless a license is added later, the source code is not offered under an open-source license.
