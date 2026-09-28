# Yuktix Blog

This repository contains the Yuktix blog built with MkDocs and the Material theme.

## Installation

Python 3.10 or newer is recommended.

1. Clone the repository and enter its directory:

   ```bash
   git clone <repository-url>
   cd mkdocs-blog
   ```

2. Create and activate a virtual environment:

   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

   On Windows PowerShell, activate it with:

   ```powershell
   venv\Scripts\Activate.ps1
   ```

3. Install the required packages:

   ```bash
   python -m pip install --upgrade pip
   python -m pip install mkdocs-material mkdocs-macros-plugin
   ```

4. Start the local development server:

   ```bash
   mkdocs serve
   ```

   Open <http://127.0.0.1:8000> in a browser.

## Build

Create the static site with:

```bash
mkdocs build
```

The `site_dir` setting in `mkdocs.yml` currently points to
`/home/tank/blog`. Change it to a suitable output directory when running the
project on another machine.
