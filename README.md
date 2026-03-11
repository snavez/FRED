# FRED — Formant Research for EDucation

A browser-based tool for visualising acoustic speech data. Upload your formant data (CSV/TSV) and generate publication-quality plots of vowel spaces, trajectories, durations, and distributions.

**No account needed. No data uploaded to any server.** Everything runs locally in your browser.

---

## Quick Start (5 minutes)

### Step 1: Install Node.js

You only need to do this once. Node.js is a free tool that lets you run the app.

**Go to: https://nodejs.org**

- Click the big green **LTS** download button
- Run the installer — accept all the defaults, just keep clicking "Next"
- **Windows**: The installer handles everything
- **Mac**: The installer handles everything (or use `brew install node` if you have Homebrew)

To check it worked, open a terminal and type:

```
node --version
```

You should see something like `v22.x.x` (any version 18+ is fine).

> **What's a terminal?**
> - **Windows**: Press `Win + R`, type `cmd`, press Enter. Or search for "Command Prompt" or "PowerShell" in the Start menu.
> - **Mac**: Press `Cmd + Space`, type `Terminal`, press Enter.

---

### Step 2: Get the FRED files

If you received a `.zip` file, extract/unzip it to a folder you can find easily (e.g., your Desktop or Documents folder).

---

### Step 3: Open a terminal in the FRED folder

You need your terminal to be "inside" the FRED folder:

- **Windows (easiest)**: Open the FRED folder in File Explorer, click in the address bar at the top, type `cmd`, and press Enter. A terminal will open already in the right place.
- **Mac**: Open Terminal, then type `cd ` (with a space after it), drag the FRED folder onto the Terminal window, and press Enter.

You should see something like:

```
C:\Users\you\Desktop\FRED>
```

or

```
you@mac ~/Desktop/FRED $
```

---

### Step 4: Install dependencies and run

Type these two commands, one at a time:

```
npm install
```

This downloads the libraries FRED needs (takes 30-60 seconds the first time). You'll see a lot of text — that's normal. Wait until it finishes and you see your prompt again.

Then:

```
npm run dev
```

You should see output like:

```
  VITE v6.x.x  ready in 500ms

  ➜  Local:   http://localhost:3000/
```

---

### Step 5: Open in your browser

Open your web browser (Chrome, Firefox, Safari, or Edge all work) and go to:

**http://localhost:3000**

FRED will load with some demo data so you can explore right away. Upload your own CSV/TSV using the sidebar.

---

### Stopping and restarting

- **To stop**: Go back to the terminal and press `Ctrl + C`
- **To restart later**: Open a terminal in the FRED folder again and run `npm run dev` (you don't need to run `npm install` again)

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node: command not found` | Node.js isn't installed, or you need to close and reopen your terminal after installing |
| `npm install` shows errors | Make sure you're in the FRED folder (the one containing `package.json`) |
| Browser shows a blank page | Make sure the terminal still shows the app running. Try a hard refresh: `Ctrl + Shift + R` |
| Port 3000 already in use | Another app is using that port. Close it, or the terminal will suggest an alternative port |
| Lots of yellow warnings during `npm install` | These are normal and can be ignored — look for the final line saying `added X packages` |

---

## What can FRED do?

- **Upload** CSV/TSV files with formant data (F1, F2, F3 trajectories)
- **Auto-detect** column types — no need to rename your columns
- **Filter** by phoneme, speaker, stress, alignment, and any categorical field
- **6 plot types**: F1/F2 scatter, F1/F2 trajectories, 3D F1/F2/F3, time-series trajectories, duration box plots, phoneme distributions
- **Multi-layer overlays**: Compare different filtered subsets on the same plot
- **Customise** colours, shapes, line styles per category per layer
- **Export** publication-quality PNG images with full layout control
- **Greyscale mode** for B&W print

---

*Powered by React, Vite, and Canvas 2D.*
