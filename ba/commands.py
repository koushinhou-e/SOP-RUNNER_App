"""确认命令生成：{{param}} 模板 → 具体命令（只生成文本，绝不执行）。

安全约定（lint 会检查）:
  * aws 命令必须带 --no-cli-pager 和 --output（避免分页器/交互）
  * ssh 必须带 -o BatchMode=yes（无密码提示，失败即退出）
  * 检出可能修改资源的 aws 子命令、交互式工具、破坏性命令 → 警告
  * 参数值若包含 shell 特殊字符，会按目标（sh / ps1）加单引号转义
"""
import datetime
import re

PH = re.compile(r"\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}")
SAFE_VALUE = re.compile(r"^[A-Za-z0-9._:/@,=+%-]*$")

AWS = re.compile(r"(^|[\s;|&(])aws\s")
SSH = re.compile(r"(^|[\s;|&(])ssh\s")
AWS_MUTATING = re.compile(r"(^|[\s;|&(])aws\s+(?:--\S+\s+(?:\S+\s+)?)*[a-z0-9-]+\s+(create|delete|terminate|stop|start|reboot|run|modify|put|attach|detach|associate|disassociate|update|remove|authorize|revoke|import|copy|register|deregister|reset|replace|cancel|enable|disable|send|invoke|apply|restore|release|allocate)-")
INTERACTIVE = re.compile(r"(^|[\s;|&'\"(])(less|more|vi|vim|nano|top|htop|passwd|mysql|psql|sqlplus|telnet|ftp)(?=$|[\s'\";|)])")
SUDO_NO_N = re.compile(r"(^|[\s;|&'\"(])sudo(?!\s+-n)\b")
DESTRUCTIVE = re.compile(r"(^|[\s;|&'\"(])(rm\s+-|shutdown|reboot|halt|poweroff|mkfs|dd\s+if=|systemctl\s+(stop|restart|disable)|kill\s|>\s*/)")


def quote(value, target):
    v = str(value)
    if SAFE_VALUE.match(v):
        return v
    if target == "ps1":
        return "'" + v.replace("'", "''") + "'"
    return "'" + v.replace("'", "'\"'\"'") + "'"


def render(template, ctx, target="sh"):
    missing, quoted = [], []

    def rep(m):
        k = m.group(1)
        v = ctx.get(k)
        if v is None or str(v).strip() == "":
            missing.append(k)
            return m.group(0)
        q = quote(str(v).strip(), target)
        if q != str(v).strip():
            quoted.append(k)
        return q
    return PH.sub(rep, template), sorted(set(missing)), sorted(set(quoted))


def lint(cmd):
    w = []
    if AWS.search(cmd):
        if "--no-cli-pager" not in cmd:
            w.append("aws 命令缺少 --no-cli-pager（可能进入分页器）")
        if not re.search(r"--output(\s|=)", cmd):
            w.append("aws 命令缺少 --output（输出格式不确定）")
        if AWS_MUTATING.search(cmd):
            w.append("疑似会修改资源的 aws 子命令（非只读）")
    if SSH.search(cmd) and "BatchMode=yes" not in cmd:
        w.append("ssh 缺少 -o BatchMode=yes（可能等待密码/确认输入）")
    if INTERACTIVE.search(cmd):
        w.append("包含交互式程序（less/vi/top 等），非交互会话中会卡住")
    if SUDO_NO_N.search(cmd):
        w.append("sudo 未加 -n，可能等待密码")
    if DESTRUCTIVE.search(cmd):
        w.append("包含破坏性/变更类命令")
    return w


def placeholders(template):
    return sorted(set(PH.findall(template or "")))


def generate(templates, ctx):
    out = []
    for i, t in enumerate(templates):
        sh, missing, quoted = render(t.get("template", ""), ctx, "sh")
        ps1, _, _ = render(t.get("template", ""), ctx, "ps1")
        out.append({
            "id": t.get("id") or "c%d" % (i + 1), "title": t.get("title", ""), "kind": t.get("kind", ""), "checks": t.get("checks", ""),
            "sh": sh, "ps1": ps1, "missing": missing, "quoted": quoted, "warnings": lint(t.get("template", "")),
        })
    return out


def to_script(generated, target, meta):
    now = meta.get("now") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    head = [
        "構築作業助手 v2 で生成した確認コマンド / 构建作业助手 v2 生成的确认命令",
        "作業: %s / サーバ: %s / 生成日時: %s" % (meta.get("job_name", ""), meta.get("server", ""), now),
        "このスクリプトは自動実行されません。内容を確認してから手動で実行してください。",
        "本脚本不会被自动执行。请审阅后再手动运行。",
    ]
    lines = []
    if target == "ps1":
        lines += ["# " + h for h in head]
        lines += ["$ErrorActionPreference = 'Continue'", "$env:AWS_PAGER = ''", ""]
    else:
        lines += ["#!/usr/bin/env bash"] + ["# " + h for h in head]
        lines += ["set -u", "export AWS_PAGER=''", ""]
    for n, g in enumerate(generated, 1):
        title = "[%d] %s" % (n, g["title"])
        if g["checks"]:
            title += " (check: %s)" % g["checks"]
        lines.append("# " + "-" * 60)
        for w in g["warnings"]:
            lines.append("# WARNING: " + w)
        if g["missing"]:
            lines.append("# MISSING: " + ", ".join(g["missing"]) + "  (未解決のプレースホルダ / 未解析的占位符)")
        if target == "ps1":
            lines.append("Write-Host '### %s'" % title.replace("'", "''"))
            cmd = g["ps1"]
        else:
            lines.append("echo '### %s'" % title.replace("'", "'\"'\"'"))
            cmd = g["sh"]
        lines.append(("# " + cmd) if g["missing"] else cmd)
        lines.append("")
    return "\n".join(lines) + "\n"
