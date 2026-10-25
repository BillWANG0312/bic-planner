# 指定顾问跨报告完成度清单 v1（v1.12.0）

基线868866115c1b5546766557171a952bb0e28ee5fc；2026-10-25开始工作区干净，PR6 OPEN/DRAFT/MERGEABLE，无反馈。用户已授权自主推进。本轮交付明确选择报告的必要完成度CSV，非去标识统计；不做分数/推荐排名汇总，不变更schema5/API健康2。

## 服务与协议

TeacherSummaryService(db,clock=time.time)，read(recipient_id,grant_ids)。只使用现有teacher_grants/full_report_read_only；编辑授权、家长分享/邀请、角色本身不授权限。POST /api/teacher-summaries，体{grant_ids:[1–20个唯一安全ASCII ID]}，writable_session验证Origin/CSRF及身份，但接口只读。用单次JOIN SQL快照读取这批指定接收人的授权+报告，逐份校验双方启用/角色/归属/修订/到期/撤销与严格归档，整批失败不返回部分数据。未知/跨账号/失效404，重复/多余字段/格式422，重复原报告422，旧/未知题库409 VERSION，损坏503隐藏私文。无新表/持久化/网络依赖。

JSON精确{format:'bic-teacher-completion-summary',version:1,items:[{grant,report}]}；grant沿用现有12键元数据/scope，只接受active。report精确{id,revision,report_ref,name,grade,bank_version,catalog_version,status,academic,planning,personality}。id/report_ref/name/revision对应同份授权，grade只允许空或8/9/10/11，按报告引擎基本信息优先、规划有效年级回退；bank_version必须当前2026.10，catalog_version为原归档字符串或null（完成度不使用院校规则，不需当前目录）。status为complete/draft，只有60学术+13个规划必答+24人格已答才complete，weakSubjects可选题缺答不阻止完整状态。

academic固定顺序english/maths/physics/chemistry，每行{key,answered,total:15}，按en/ma/ph/ch题ID前缀、严格validatedstate的有效非null答案统计，数值0和选项0计已答；planning{answered,total:14,required_answered,required_total:13}，有效单选/非空多选算已答；weakSubjects可选题明确回答空数组也计已答，缺省不计但不影响必答完整；基本信息grade存在时与现有generateReport一致补入规划grade；personality{answered,total:24}，非null合法0–4计已答。不输出原答案、对错、姓名外其他身份/日期、顾问文字/actor审计、人格类型、专业/地区、录取判断或凭据。元数据中的owner/recipient/授权ID仅供内存绑定，不入CSV。

## 浏览器纯模块

js/teacher-summary.js导出window.TeacherSummary={validate,build}。validate(payload,username)返回严格校验的深拷贝；build(payload,username)返回{rows,csv}，rows为report字段白名单且深拷贝（不得包含grant/id/actor等内部字段），csv固定BOM/CRLF/全字段引号与RFC双引号转义。列固定中文：姓名、报告编号、年级、服务端修订、题库版本、目录版本、完成状态、英语已答、英语总题、数学已答、数学总题、物理已答、物理总题、化学已答、化学总题、规划已答、规划总题、规划必答已答、规划必答总题、性格已答、性格总题。未知目录显示未记录。状态中文必答已完成/必答未完成。首个非空白字符= + - @或原始前导TAB/CR/LF时前缀单引号防CSV公式；保持其他原文。重复授权/报告ID/报告编号、错账号/scope/status、数组/计数/版本/状态矛盾、额外字段一律拒绝。固定1–20份，文案明确这是带身份的私密校内清单，不能称匿名/成绩或真实校准。

## 页面与新鲜度

独立teacher-summary.html + js/teacher-summary-ui.js + css/teacher-summary.css，只加载cloud-config/client/teacher-summary纯模块/UI，不加载bank/report/store/app/analytics，不访问浏览器存储。默认断开/不请求，主动连接/登录后仍不自动列报告，点击刷新调用listTeacherReports仅元数据。操作者逐份选1–20个只读授权，不默认全选/选择全部，不从编辑授权读取。请求readTeacherSummaries(grantIds)仅所选ID，返回顺序对应选择；不能调用full-read原答卷接口。

ID summaryConnectBtn/DisconnectBtn/ConnectPanel/LoginForm/Username/Password/Workspace/Account/RefreshBtn/LogoutBtn/Status/List/PreviewBtn/ExportBtn/Preview/Table（均前缀summary，大小写按此拼接）。名单checkbox data-summary-grant=id。纯文本表格，固定文件名bic-teacher-completion-v1.csv，Blob UTF8下载。

点击预览读取单批快照，严格验证后显示相同CSV对应行，保存payload+csv仅内存，绑定当前username/id/所选ID/批次epoch。任意选择/刷新/身份变化清预览，不静默重算。导出先重新读同批比对完整payload、所选ID及身份，确认含身份仅校内保管提示后，再读同批/比对；发生源修订/授权/资料/身份变化或读取失败清预览并停止，不产生文件，无自动重试。取消确认不下载。不把最后核对之后撤销能回收已下载文件当保证。

到期定时清已预览行/选择；刷新移除失效授权清旧选择/预览，断开/注销/离开/换账号清名单和CSV，迟到响应不能恢复私密；账号Cookie跨标签变化由X-CSRF绑定拒绝。失败不保留旧CSV下载入口。无轮询/自动读取、上传、持久化或新增后端状态。

## 分工与验证

服务/权限/count与单SQL快照一组，纯协议/CSV模块一组，独立页面/UI与生命周期一组；主协调API/client/宿主入口/真实API/文档/打包。各组TDD先失败后实现，最终独立审查。定向覆盖0/null/空多选/grade补入/旧版本、整批拒绝/角色/禁用/期限/撤销/修订、恶意CSV/重复、前后确认新鲜度与迟到/换账号/到期、取消/无存储/375px；完整前端/后端/真实API回归。保留schema5及旧迁移验证，打包默认关闭/无DB/秘密，更新进度与heartbeat，推fork更新草稿，不合并或生产部署。
