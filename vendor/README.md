# vendor/

Pure-Python third-party packages bundled so the app runs without `pip install`.
`app.py` inserts this folder at the front of `sys.path`.

| Package | Version | License | Source |
|---|---|---|---|
| openpyxl | 3.1.5 | MIT (see openpyxl-3.1.5.dist-info/LICENCE.rst) | PyPI wheel `openpyxl-3.1.5-py2.py3-none-any.whl` |
| et_xmlfile | 2.0.0 | MIT (see et_xmlfile-2.0.0.dist-info/LICENCE.rst) | PyPI wheel `et_xmlfile-2.0.0-py3-none-any.whl` |

Browser-side: `web/vendor/jszip.min.js` — JSZip 3.10.1 (MIT or GPLv3, license header kept in the file).

No compiled extensions (no lxml, no Pillow). To update:

    pip download --no-deps --only-binary=:all: -d _dl openpyxl==X et_xmlfile==Y
    # unzip the wheels into vendor/ (keep the *.dist-info folders for the license files)
