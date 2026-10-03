import json
import os
import unittest

import _util
from ba import commands, paramsheet

SNAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "snapshots")


def generated(server="web01"):
    with open(_util.CMDS, encoding="utf-8") as f:
        tpl = json.load(f)["templates"]
    ctx = paramsheet.server_context(paramsheet.parse(_util.PARAMS), server)
    return commands.generate(tpl, ctx)


class CommandsTest(unittest.TestCase):
    def test_snapshot(self):
        gen = generated("web01")
        for target in ("sh", "ps1"):
            text = commands.to_script(gen, target, {"job_name": "snapshot", "server": "web01", "now": "2026-01-01 00:00:00"})
            path = os.path.join(SNAP, "web01_check.%s" % target)
            if os.environ.get("UPDATE_SNAPSHOTS") or not os.path.exists(path):
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    f.write(text)
            with open(path, encoding="utf-8") as f:
                self.assertEqual(text, f.read(), "snapshot mismatch: " + path)

    def test_sample_templates_are_safe_and_complete(self):
        for g in generated("db01"):
            self.assertEqual(g["warnings"], [], g["title"])
            self.assertEqual(g["missing"], [], g["title"])
            if g["kind"] == "aws":
                self.assertIn("--no-cli-pager", g["sh"])
                self.assertIn("--output text", g["sh"])
            if g["kind"] == "linux":
                self.assertIn("-o BatchMode=yes", g["sh"])
        self.assertIn("i-0fedcba9876543210", generated("db01")[0]["sh"])

    def test_lint(self):
        self.assertTrue(any("--no-cli-pager" in w for w in commands.lint("aws ec2 describe-instances --output json")))
        self.assertTrue(any("--output" in w for w in commands.lint("aws ec2 describe-instances --no-cli-pager")))
        self.assertTrue(any("非只读" in w for w in commands.lint("aws ec2 terminate-instances --instance-ids i-1 --output text --no-cli-pager")))
        self.assertTrue(any("非只读" in w for w in commands.lint("aws --region ap-northeast-1 ec2 stop-instances --output text --no-cli-pager")))
        self.assertTrue(any("BatchMode" in w for w in commands.lint("ssh ec2-user@192.0.2.11 'free -g'")))
        self.assertTrue(any("交互" in w for w in commands.lint("ssh -o BatchMode=yes h 'less /var/log/messages'")))
        self.assertTrue(any("sudo" in w for w in commands.lint("ssh -o BatchMode=yes h 'sudo cat /etc/shadow'")))
        self.assertEqual(commands.lint("ssh -o BatchMode=yes h 'sudo -n cat /etc/hosts'"), [])
        self.assertTrue(any("破坏" in w for w in commands.lint("ssh -o BatchMode=yes h 'rm -rf /tmp/x'")))
        self.assertEqual(commands.lint("aws ec2 describe-instances --output text --no-cli-pager"), [])

    def test_missing_placeholder_is_commented_out(self):
        gen = commands.generate([{"title": "t", "template": "aws ec2 describe-instances --instance-ids {{nope}} --output text --no-cli-pager"}], {})
        self.assertEqual(gen[0]["missing"], ["nope"])
        sh = commands.to_script(gen, "sh", {"now": "x"})
        self.assertIn("# aws ec2 describe-instances --instance-ids {{nope}}", sh)

    def test_quoting_prevents_injection(self):
        evil = "x; rm -rf ~ $(whoami) 'q'"
        sh, _, quoted = commands.render("echo {{v}}", {"v": evil}, "sh")
        self.assertEqual(sh, "echo 'x; rm -rf ~ $(whoami) '\"'\"'q'\"'\"''")
        self.assertEqual(quoted, ["v"])
        ps, _, _ = commands.render("echo {{v}}", {"v": evil}, "ps1")
        self.assertEqual(ps, "echo 'x; rm -rf ~ $(whoami) ''q'''")
        self.assertEqual(commands.render("{{a}}", {"a": "i-0123456789abcdef0"})[0], "i-0123456789abcdef0")
