/* Safe fixed choice dictionary; no student records or recommendations. */
window.BIC_PREFERENCE_SCHEMA = {
  "metadata": {
    "bank_version": "2026.10",
    "schema_version": "planning-preferences-v1",
    "schema_fingerprint": "7b1bbe33915de6d6f9a6d3541e3377584d83b75058aa4c81365750ca96c08cc4",
    "basis": "explicit_student_choices"
  },
  "questions": [
    {
      "key": "preferredMajor",
      "max": 2,
      "options": [
        {
          "id": "science",
          "label": "自然科学"
        },
        {
          "id": "math",
          "label": "数学"
        },
        {
          "id": "eng",
          "label": "工程"
        },
        {
          "id": "tech",
          "label": "计算机与人工智能"
        },
        {
          "id": "business",
          "label": "商科与管理"
        },
        {
          "id": "econ",
          "label": "经济与金融"
        },
        {
          "id": "med",
          "label": "医学与健康"
        },
        {
          "id": "social",
          "label": "社会科学"
        },
        {
          "id": "humanities",
          "label": "人文与法律"
        },
        {
          "id": "art",
          "label": "艺术与设计"
        },
        {
          "id": "media",
          "label": "传媒"
        },
        {
          "id": "unsure",
          "label": "还不确定"
        }
      ]
    },
    {
      "key": "countries",
      "max": 3,
      "options": [
        {
          "id": "uk",
          "label": "英国"
        },
        {
          "id": "us",
          "label": "美国"
        },
        {
          "id": "ca",
          "label": "加拿大"
        },
        {
          "id": "au",
          "label": "澳大利亚"
        },
        {
          "id": "hk",
          "label": "中国香港"
        },
        {
          "id": "sg",
          "label": "新加坡"
        },
        {
          "id": "eu",
          "label": "欧洲大陆"
        },
        {
          "id": "unsure",
          "label": "还没想好"
        }
      ]
    }
  ]
};
