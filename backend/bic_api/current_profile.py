"""Bridge between the current question bank (games / traits) and legacy archive fields.

旧版存档契约保持冻结：ArchiveRecord 仍然要求旧版题材与题目 id。当前版本只有 30 道
特质题改存旧版 24 题整数；规划作答（含分格、搭档与靶环）原样保存，读取时换回当前形状。
"""

from __future__ import annotations

from typing import Any

# 与 js/games.js 的 GAME_CONFIG 保持一致（backend/tools/current-profile-check.cjs 会核对）。
GAMES = {
    "campus": {
        "items": ["数学", "物理", "化学", "生物", "计算机", "经济", "历史", "英语文学", "心理学", "设计"],
        "lanes": ["like", "try", "avoid"],
        "capacity": 4,
    },
    "planet": {
        "majors": ["cs", "math", "phys", "eng", "chem", "med", "bio", "econ", "biz", "law",
                   "psych", "design", "media", "intl"],
        "lanes": ["heart", "watch", "skip"],
        "capacity": 3,
    },
    "dart": {
        "rings": ["ideas", "people", "systems", "science", "build", "market"],
        "max": 2,
    },
    "race": {
        "pace": ["deep", "varied", "steady", "deadline"],
        "partners": ["star", "maker", "artist", "captain", "caretaker"],
    },
}
# 旧版 groupSize 是单选；当前版本的搭档 id 直接存进去，只有三个规模的存档才按旧版处理。
RACE_PARTNERS = GAMES["race"]["partners"]

# 兴趣选项 id → 专业 id（js/majors.js 的 INTEREST_OPTIONS）。
INTEREST_MAJOR = {
    "science": "phys",
    "math": "math",
    "eng": "eng",
    "tech": "cs",
    "business": "biz",
    "econ": "econ",
    "med": "med",
    "social": "psych",
    "humanities": "law",
    "art": "design",
    "media": "media",
    "unsure": None,
}
# 专业 id → 能表示它的旧版专业意向选项；化学 / 生物 / 商科没有对应选项。
MAJOR_OPTION = {major: option for option, major in INTEREST_MAJOR.items() if major}
MAJOR_OPTION.update({"law": "humanities", "media": "media"})
CAREER_IDS = ("researcher", "tech", "finance", "medicine", "law", "creative", "entrepreneur", "unsure")
CURRENT_PROFILE = "games-traits-v1"
LEGACY_PROFILE = "legacy-2026.10"
# 旧版专业意向选项不含这几类；报告里仍由专业分格与兴趣素材表示。
UNMAPPED_MAJORS = ("chem", "bio", "biz")
PARTNER_GROUP_SIZES = tuple(f"partner:{partner}" for partner in GAMES["race"]["partners"])
# 旧版团队规模单选的选项；与搭档 id 形状不同，读取时原样保留。
GROUP_SIZES = ("small", "medium", "large")
TRAIT_COUNT = 30
# 旧版冻结问卷的性格题数；换算出来的分数最多 24 项。
MBTI_COUNT = 24
TRAIT_SCALE = (0, 1, 2, 3, 4)


class AnswerError(ValueError):
    """当前版本作答不合法；沿用旧版模型的错误措辞。"""


def _items(value: Any, kind: str) -> set[str]:
    if not isinstance(value, list):
        raise AnswerError(f"{kind} answers must be an array")
    if len(set(map(str, value))) != len(value):
        raise AnswerError(f"duplicate {kind} answer")
    if not all(isinstance(item, str) for item in value):
        raise AnswerError(f"{kind} answers must be text")
    return set(value)


def _limited(items: set[str], allowed: set[str] | tuple[str, ...], length: int, kind: str) -> None:
    if len(items) > length or not items <= set(allowed):
        raise AnswerError(f"unsupported {kind} answer")


def lanes(answer: Any, game: str) -> dict[str, list[str]]:
    """分格游戏：每格是 id 数组，同一 id 只出现一次，每格不超过容量。"""
    config = GAMES[game]
    if not isinstance(answer, dict):
        raise AnswerError(f"{game} answers must be an object")
    result = {}
    seen: set[str] = set()
    for lane, items in answer.items():
        if lane not in config["lanes"]:
            raise AnswerError(f"unknown {game} lane")
        chosen = _items(items, game)
        _limited(chosen, config["items"] if game == "campus" else config["majors"], config["capacity"], game)
        if chosen & seen:
            raise AnswerError(f"duplicate {game} answer")
        seen |= chosen
        result[lane] = list(items)
    return result


def career(answer: Any) -> list[str]:
    """靶环素材：旧版职业方向 id 或当前版本的靶环 id，最多两项。"""
    chosen = _items(answer, "career")
    _limited(chosen, [*GAMES["dart"]["rings"], *CAREER_IDS], GAMES["dart"]["max"], "career")
    return list(answer)


def race(answer: Any) -> dict[str, str]:
    if not isinstance(answer, dict):
        raise AnswerError("race answers must be an object")
    unknown = set(answer) - {"pace", "partner"}
    if unknown:
        raise AnswerError("unknown race answer")
    result = {}
    if "pace" in answer:
        if not isinstance(answer["pace"], str) or answer["pace"] not in GAMES["race"]["pace"]:
            raise AnswerError("invalid race pace")
        result["pace"] = answer["pace"]
    if "partner" in answer:
        if not isinstance(answer["partner"], str) or answer["partner"] not in GAMES["race"]["partners"]:
            raise AnswerError("invalid race partner")
        result["partner"] = answer["partner"]
    return result


# 兼容旧名字。
dart = career

# 旧版职业方向 → 当前靶环：旧版引擎排在第一位的职业 id 映射到第一个命中的靶环。
CAREER_RINGS = {
    "creative": "ideas", "medicine": "people", "law": "systems", "researcher": "science",
    "tech": "build", "finance": "market", "entrepreneur": "market",
}


def career_for_current(answer: Any) -> list[str]:
    """只保留靶环；旧版职业方向换成当前靶环，认不出或超过两项的旧作答原样保留。

    旧版唯一能选的「还没想好」不是靶环，换算时去掉；页面重新打开时这道题按未作答显示。
    """
    if not isinstance(answer, list) or len(answer) > GAMES["dart"]["max"]:
        return list(answer) if isinstance(answer, list) else answer
    rings = [CAREER_RINGS.get(item) for item in answer if item in CAREER_IDS]
    if [item for item in answer if item not in CAREER_IDS] or any(item is None for item in rings):
        return list(answer)
    return list(dict.fromkeys(rings))


def derived_majors(answer: Any) -> list[str]:
    """preferredMajor 素材：兴趣选项 id、旧版专业意向选项或专业 id（含「还没想好」）。"""
    if not isinstance(answer, list):
        raise AnswerError("preferredMajor answers must be an array")
    majors = set(INTEREST_MAJOR.values()) | set(UNMAPPED_MAJORS)
    unknown = [item for item in answer if not isinstance(item, str) or item not in INTEREST_MAJOR and item not in majors]
    if unknown:
        raise AnswerError("unsupported preferredMajor answer")
    return list(answer)


def major_ids(value: list[Any]) -> list[str]:
    """兴趣选项 / 专业 id → 去重后的专业 id。"""
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        major = INTEREST_MAJOR.get(item) or (item if item in INTEREST_MAJOR.values() or item in UNMAPPED_MAJORS else None)
        if major and major not in result:
            result.append(major)
    return result


def traits_from_answers(answer: Any) -> list[int | None]:
    """30 道特质题（作答时的原始分值 {value, ms} 或整数）→ 旧版 24 题整数数组（奇数为反向题，换算后同向）。

    报告页会按 30 道特质题整份补 null 占位（前半段没作答时 30 项全是 null），这不超出题目数；
    只有真正作答的项超过题目数才拒绝。整数按作答分值处理：当前版本提交和读取接口回显的整数
    都是原始分值，换算一次就得到存档里的同向分数。
    """
    if not isinstance(answer, list):
        raise AnswerError("personality answers must be an array")
    answered = len([item for item in answer if item is not None])
    if answered > max(len(answer), TRAIT_COUNT):
        raise AnswerError("too many personality answers")
    result: list[int | None] = []
    # 未作答的位置以 None 表示（JSON 里是 null）。
    items = [None if item is None or item.get("value") is None else item for item in answer]
    for index, item in enumerate(items[:24]):
        if item is None:
            result.append(None)
        elif type(item) in (int, float):
            if item not in TRAIT_SCALE:
                raise AnswerError("personality answer must be an integer on the supported scale")
            result.append(4 - item if index % 2 == 1 else item)
        else:
            if not isinstance(item, dict) or set(item) - {"value", "ms"}:
                raise AnswerError("invalid personality answer")
            value = item.get("value")
            if type(value) not in (int, float) or value not in TRAIT_SCALE:
                raise AnswerError("personality answer must be an integer on the supported scale")
            result.append(4 - value if index % 2 == 1 else value)
    return result


def unanswered(answer: Any) -> list[Any]:
    """旧版 24 题整数数组或空列表，统一成可比较的形状。"""
    if not isinstance(answer, list):
        raise AnswerError("personality answers must be an array")
    # 报告页按 30 道特质题整份补 null 占位：一项都没作答时是 30 个空位，读取时靠它认出版本；
    # 超出旧版题数又有一项作答的数组才算「作答太多」。
    if len(answer) > 24 and any(item is not None for item in answer):
        raise AnswerError("too many personality answers")
    for item in answer:
        if item is None:
            continue
        # 旧版存档接受 0–4 的整数（含 2.0 这类整数值浮点数）。
        if type(item) not in (int, float) or item not in TRAIT_SCALE:
            raise AnswerError("answer must be an integer on the supported scale")
    return list(answer)


# ---------------- 读取：旧版兼容存档 → 当前形状 ----------------


def interest_for_majors(majors: list[str]) -> list[str]:
    """专业 id → 兴趣选项 id；一个专业选项覆盖全部专业（「还没想好」）时为空。"""
    result = []
    for item, major in MAJOR_OPTION.items():
        if major and major in majors and item not in result:
            result.append(item)
    return result


def plan_for_current(plan: dict[str, Any]) -> dict[str, Any]:
    """把旧版兼容存档的规划字段还原成当前版本报告所需的素材。

    当前版本自己写的分格 / 靶环 / 搭档原样保存，读取时只把旧版职业方向换回靶环；
    旧版作答（schoolSubjects / weakSubjects / preferredMajor / timeStyle / groupSize）按同一问题还原。
    """
    result = dict(plan)
    # 未作答的旧版题不出现在读取结果里；只还原存档里真有作答的字段。
    mapped = ("schoolSubjects", "weakSubjects", "preferredMajor", "timeStyle", "groupSize",
              "subjectBoard", "majorBoard", "team")
    school = list(plan.get("schoolSubjects") or [])
    # 提交时 schoolSubjects = 我喜欢；weakSubjects = 想试试 + 不想学。旧版只有这两道题，按同一问题换算。
    if "subjectBoard" not in plan and (school or plan.get("weakSubjects")):
        result["subjectBoard"] = {"like": school, "try": [], "avoid": list(plan.get("weakSubjects") or [])}
    hints = list(plan.get("preferredMajor") or [])
    # 旧版专业意向按选项换算成心动专业；「还没想好」展开成全部专业，读取时不能再把它当成心动专业。
    # 当前版本已写有心动专业时以它为准，旧版素材题不再写回（与页面收录当前版本记录时去掉的键一致）。
    majors = [] if "majorBoard" in plan else [major for major in major_ids(hints)
                                               if major not in UNMAPPED_MAJORS or major in GAMES["planet"]["majors"]]
    if "majorBoard" not in plan and majors and "unsure" not in hints:
        result["majorBoard"] = {"heart": majors, "watch": [], "skip": []}
    # timeStyle 与 groupSize 是当前版本的团队题换算出的存档：按同一问题换回节奏与搭档后，
    # 旧版独有的键不再留在这份（当前形状的）作答里，与页面收录当前版本记录时去掉的键一致。
    partner = partner_value(plan.get("groupSize"))
    if plan.get("timeStyle") is not None:
        result["team"] = {**result.get("team", {}), "pace": plan["timeStyle"]}
        result.pop("timeStyle", None)
    if partner:
        result["team"] = {**result.get("team", {}), "partner": partner[8:]}
        result.pop("groupSize", None)
    elif "groupSize" in result:
        result.pop("groupSize")
    career = plan.get("career")
    if isinstance(career, list) and any(item in CAREER_IDS for item in career):
        # 旧版存档里的职业方向换回靶环；当前版本的靶环原样保留。
        result["career"] = career_for_current(career)
    # 分格为空数组时照样保留（页面区分「未作答」与「作答而后取消」），这里只去掉空的值。
    for key in mapped:
        if result.get(key) in (None, [], {}):
            result.pop(key, None)
    return result


# 当前版本的 12 道必答规划题，键名与 js/plan.js 的 PLAN_QUESTIONS 一致（选填的 weakSubjects 不计入）。
REQUIRED_PLAN = ("grade", "interests", "subjectBoard", "career", "clubs", "majorBoard", "team", "selfImage",
                 "freeTime", "countries", "subjectPerf", "preferredLength")


def _filled_board(board: Any) -> bool:
    """分格里有任一项目才算作答（空格子也是非空对象）。"""
    return isinstance(board, dict) and any(bool(items) for items in board.values())


def plan_answered(plan: dict[str, Any], key: str) -> bool:
    """规划题是否作答，与页面统计完成度（report.js 的 planCoverage）同一口径。

    规划作答同时带着当前形状的键与旧版独有的键时（读取接口换回当前形状的记录再提交），
    以当前形状的键为准：旧版键只是换算保存留下的另一份作答。
    """
    if key == "team":
        # 游戏题的键是 team（不是 race）；只选了节奏或搭档的未完成作答在页面里不算作答。
        team = plan.get("team") if isinstance(plan.get("team"), dict) else {}
        return bool(team.get("pace")) and bool(team.get("partner"))
    if key == "career":
        # 旧版存档的职业方向换算成靶环后，挑不出靶环的作答（如只有「还没想好」）在页面里不算作答。
        rings = career_for_current(plan.get("career"))
        return isinstance(rings, list) and bool(rings) and all(ring in GAMES["dart"]["rings"] for ring in rings)
    # 分格游戏按格子里的项目数计；旧版同一问题的字段（学科 / 专业意向）答了就算。
    if key == "subjectBoard":
        return _filled_board(plan.get("subjectBoard")) if "subjectBoard" in plan else bool(plan.get("schoolSubjects"))
    if key == "majorBoard":
        return _filled_board(plan.get("majorBoard")) if "majorBoard" in plan else bool(plan.get("preferredMajor"))
    value = plan.get(key)
    return value is not None and value != "" and value != [] and value != {}


def converted_scores(answer: list[Any]) -> bool:
    """存档里的整数是否已是换算（反向题翻转过）后的同向分数，而不是作答时的原始分值。

    页面重新提交回显的记录时保存的整数与作答时的原始分值不同：第一道反向题落在 4 分一侧
    （原始分值去掉 2 分一档后算出的同向分数都会落在 2 分以上）。
    """
    return any(index % 2 == 1 and value == 4 for index, value in enumerate(answer[:MBTI_COUNT]))


# 存档里没有反向题的 4 分作答时两种来源分不清：按换算后的分数处理，与读取接口先前的约定一致。
def _converted(answer: list[Any]) -> bool:
    return converted_scores(answer) or not any(index % 2 == 1 and value is not None
                                               for index, value in enumerate(answer[:MBTI_COUNT]))


def stored_traits(answer: list[Any]) -> list[dict[str, Any] | None]:
    """换算存档里的旧版 24 题整数 → 30 道特质题的前 24 项。

    换算出的整数是翻转过反向题的同向分数，换回作答时再翻转一次；旧版引擎自己保存的整数
    本来就是同向分数，原样放回。两种来源从这里分不清，交给页面按作答的分值形状重新整理。
    """
    flipped = _converted(answer)
    result: list[dict[str, Any] | None] = [{"value": int(4 - value if flipped and index % 2 == 1 else value), "ms": None}
                                           if value is not None else None for index, value in enumerate(answer[:MBTI_COUNT])]
    result.extend([None] * (TRAIT_COUNT - len(result)))
    return result


def archival_answer(answer: list[Any]) -> list[Any]:
    """当前版本作答转换成可存进旧版兼容存档的形状；未作答的空位保留。

    带作答时按前 24 题换算整数，并补满旧版 24 项（旧版答案表按 24 项存满，空位只是未作答）；
    一项都没作答时不补：旧版存档用空列表表示尚未作答，补成全 null 会被读成另一份作答。
    """
    if not isinstance(answer, list) or not answer:
        return []
    return current_answer(traits_from_answers([None if item is None else {"value": item.get("value") if isinstance(item, dict) else item}
                                               for item in answer[:TRAIT_COUNT]]))


def current_answer(stored: list[Any]) -> list[Any]:
    """存档里的旧版 24 题整数 → 当前版本形状。

    已经是当前形状的项（读取接口算出的分数）原样保留，空位也原样保留；
    旧版存档的整数按旧版表的位置算出同向分数再翻转回来。一项都没作答时为空列表。
    """
    values = [item for item in stored if item is not None]
    if not values:
        return []
    if all(type(item) in (int, float) for item in values):
        restored = [{"value": int(4 - item if index % 2 == 1 else item), "ms": None}
                    for index, item in enumerate(stored[:MBTI_COUNT]) if item is not None]
        return restored + [None] * (TRAIT_COUNT - len(restored))
    result = [dict(item) if item is not None else None for item in stored[:TRAIT_COUNT]]
    result.extend([None] * (TRAIT_COUNT - len(result)))
    return result


def personality_for_current(answer: list[Any]) -> list[dict[str, Any] | None]:
    """由旧版引擎换算出的 24 题分数 → 30 道特质题的前 24 项（反向题再翻转回来）。

    超出 24 的项只会出现在换算出错的存档里，截掉以免打乱长度。
    """
    result: list[dict[str, Any] | None] = [{"value": int(4 - value if index % 2 == 1 else value), "ms": None}
                                           if value is not None else None
                                           for index, value in enumerate(answer[:MBTI_COUNT])]
    result.extend([None] * (TRAIT_COUNT - len(result)))
    return result


def partner_value(value: Any) -> str | None:
    """groupSize 里的当前版本搭档 id；旧版规模单选或其它值返回 None。"""
    if isinstance(value, str) and value.startswith("partner:") and value[8:] in RACE_PARTNERS:
        return value
    return None
