"""証跡画像のユーティリティ（純 Python、Pillow 不要）。

* PNG / JPEG のヘッダから形式と縦横ピクセル数を読み取る
* openpyxl の Image は Pillow を必要とするため、Pillow なしで動く RawImage を用意する
  （openpyxl の描画パーツ・リレーションの書き出しはそのまま利用し、画像バイトだけを差し替える）
"""
import struct

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def sniff(data):
    """(format, width, height) を返す。format は 'png' / 'jpeg'。対応外なら ValueError。"""
    if data[:8] == PNG_SIG and len(data) >= 24 and data[12:16] == b"IHDR":
        w, h = struct.unpack(">II", data[16:24])
        return "png", w, h
    if data[:2] == b"\xff\xd8":
        i, n = 2, len(data)
        while i + 4 <= n:
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            if marker == 0xFF:
                i += 1
                continue
            seg = struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                if i + 9 > n:
                    break
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return "jpeg", w, h
            i += 2 + seg
        raise ValueError("JPEG のサイズを読み取れません")
    raise ValueError("PNG または JPEG の画像ではありません")


def fit(w, h, max_w, max_h=None):
    """縦横比を保って max_w（と max_h）に収まるサイズを返す（拡大はしない）。"""
    s = min(1.0, float(max_w) / w if w else 1.0)
    if max_h:
        s = min(s, float(max_h) / h if h else 1.0)
    return max(1, int(round(w * s))), max(1, int(round(h * s)))


def raw_image(data, width_px, height_px):
    """Pillow を使わずに openpyxl のワークシートへ追加できる画像オブジェクトを作る。"""
    from openpyxl.drawing.image import Image

    fmt, _, _ = sniff(data)

    class RawImage(Image):
        def __init__(self):            # 親の __init__ は Pillow を呼ぶので使わない
            self.ref = None
            self.anchor = "A1"
            self.width, self.height = width_px, height_px
            self.format = fmt

        def _data(self):
            return data

    return RawImage()
