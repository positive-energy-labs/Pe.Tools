"""Fixture-level asserts for the riskiest corpus logic. Run: python .agents/skills/slot.mine/scripts/corpus/test_corpus.py"""
import json, os, re, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common, merge_labels, render, stage_commits, stage_t3


class OwnerVsRelay(unittest.TestCase):
    def test_split(self):
        k = stage_t3.user_kind
        self.assertEqual(k(dict(createdBy="user", creationSource="web")), "owner_turn")
        self.assertEqual(k(dict(createdBy="user", creationSource="mobile")), "owner_turn")
        self.assertEqual(k(dict(createdBy="user", creationSource="server")), "relay")  # child text through the user role, not a human
        self.assertEqual(k(dict(createdBy="agent", creationSource="web")), "other_user_msg")
        self.assertEqual(k(dict(createdBy="user", creationSource="server", senderThreadId="t1")), "agent_msg")  # sender marker wins
        self.assertEqual(k(dict(createdBy="user", creationSource="web", scheduledTaskId="s")), "automation")


class AttributionPrecedence(unittest.TestCase):
    def test_order(self):
        tr, ln, pa, me = dict(thread="T"), dict(thread="L", birth_ts="x"), dict(thread="P"), dict(thread="M")
        self.assertEqual(stage_commits.attribute(tr, ln, pa, me)["method"], "trailer")
        self.assertEqual(stage_commits.attribute(None, ln, pa, me)["thread"], "L")
        self.assertEqual(stage_commits.attribute(None, None, pa, me)["method"], "patch-id")
        self.assertEqual(stage_commits.attribute(None, None, None, me)["method"], "first-mention")
        self.assertEqual(stage_commits.attribute(None, None, None, None), dict(thread=None, method="unknown"))

    def test_empty_evidence_is_skipped(self):
        self.assertEqual(stage_commits.attribute(dict(thread=None), dict(thread="L"))["method"], "commit-line")


class CheckpointDebt(unittest.TestCase):
    def test_debt(self):
        runs = [1, 2, 3, 4, 5, 6, 7, 8]
        self.assertEqual(common.debt(runs, []), 8)  # no owner turn: every run is unchecked
        self.assertEqual(common.debt(runs, [4.5]), 4)  # gaps (-,4.5] and (4.5,-] hold 4 runs each
        self.assertEqual(common.debt(runs, [1.5, 2.5, 3.5]), 5)  # the open tail after the last turn is the worst gap
        self.assertEqual(common.debt([], [1]), 0)
        self.assertEqual(common.debt(runs, [], lo=4, hi=6), 2)  # epoch edges close the gap: runs 5 and 6 only


class RenderSubstitution(unittest.TestCase):
    def test_placeholders_replaced_and_json_survives(self):
        tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "page.template.html"), encoding="utf-8").read()
        for p in render.PLACEHOLDERS: self.assertEqual(tpl.count(p), 1)
        data = dict(note="</script><!-- x -->", n=1); roles = dict(roles={"abcd1234": {"1": "implementor"}}, detail={})
        html = render.substitute(tpl, data, roles)
        for p in render.PLACEHOLDERS: self.assertNotIn(p, html)
        self.assertEqual(html.count("</script>"), tpl.count("</script>"))  # a `</script>` inside data cannot close the block early
        m = re.search(r'<script type="application/json" id="retro-data">(.*?)</script>', html, re.S)
        self.assertEqual(json.loads(m.group(1)), data)
        m = re.search(r'<script type="application/json" id="retro-roles">(.*?)</script>', html, re.S)
        self.assertEqual(json.loads(m.group(1)), roles)

    def test_missing_placeholder_fails_loud(self):
        with self.assertRaises(ValueError): render.substitute("/*__RETRO_DATA__*/ x /*__RETRO_ROLES__*/ /*__RETRO_DATA__*/", {}, {})


class LabelMerge(unittest.TestCase):
    EP = {"t1": dict(short="aaaa1111", epochs=[dict(n=1, start="2026-11-01T00:00:00.000Z", end="2026-11-02T00:00:00.000Z"), dict(n=2, start="2026-11-02T00:00:00.000Z", end="2026-11-03T00:00:00.000Z")])}

    def test_merge_override_and_unknown(self):
        rows = [dict(lane="aaaa1111", epoch=1, role="purger"), dict(lane="aaaa1111", epoch=1, role="driver"), dict(lane="aaaa1111", epoch=9, role="x"), dict(lane="zzzz", epoch=1, role="x"),
                dict(lane="aaaa1111", epoch=0, lane_summary="s", notable_owner_corrections=[])]
        roles, detail, rep = merge_labels.merge(rows, self.EP)
        self.assertEqual(roles, {"aaaa1111": {"1": "driver"}})
        self.assertEqual(len(rep["overridden"]), 1); self.assertEqual(len(rep["dropped_unknown"]), 2)
        self.assertEqual(detail["aaaa1111"]["_lane"]["lane_summary"], "s")

    def test_remap_by_time_overlap(self):
        old = {"t1": dict(short="aaaa1111", epochs=[dict(n=1, start="2026-11-01T00:00:00.000Z", end="2026-11-02T06:00:00.000Z"), dict(n=2, start="2026-11-02T06:00:00.000Z", end="2026-11-03T00:00:00.000Z")])}
        out, rep = merge_labels.remap({"aaaa1111": {"1": "implementor", "2": "purger"}}, old, self.EP)
        self.assertEqual(out["aaaa1111"], {"1": "implementor", "2": "purger"})  # new epoch 2 overlaps old 1 by 6h and old 2 by 18h


if __name__ == "__main__":
    unittest.main()
