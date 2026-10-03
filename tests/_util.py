import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "vendor"))
sys.path.insert(0, ROOT)
SAMPLES = os.path.join(ROOT, "samples")
TEMPLATE = os.path.join(SAMPLES, "構築結果報告書_template_sample.xlsx")
PARAMS = os.path.join(SAMPLES, "EC2パラメータシート_sample.xlsx")
DOCX = os.path.join(SAMPLES, "Webサーバ定期パッチ適用手順書.docx")
CMDS = os.path.join(SAMPLES, "command_templates_sample.json")
