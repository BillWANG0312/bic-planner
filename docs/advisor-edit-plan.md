# 指定顾问建议文字编辑阶段计划（v1.11.0）

基线3db7e6231bb7bdf9dc438d62ed9cd27bdd430c09；PR6草稿，2026-10-25开始工作区干净，无审查反馈。用户已授权自主顺序推进，无须再次确认实现方案。本轮仅补单报告建议编辑，不做批量汇总。

## 权限与数据契约

- 独立编辑授权，旧teacher_grants/家长令牌/批注均不扩权。所有者读取服务端报告，指定另一个既有启用advisor账号，24/72/168小时，预览完整资料范围和四段文字基线，再确认。
- scope固定full_report_advice_edit。元数据与只读同12键（id/report_id/report_revision/report_name/report_ref/owner_username/recipient_username/scope/created_at/expires_at/revoked_at/status）。所有者历史状态同只读，接收人仅active。
- 单次修订绑定。仅一次有效批量提交1–4段summary/academic/plan/personality，plain text各1–4000 UTF-16；不支持reset/restore/评分/作答/身份修改。全部只变首尾空白的无操作不增修订/审计、授权保持；实际修改后源修订递增，授权source_changed，需所有者复核另授。提交后网络不确定不自动重试，先查状态。
- create_grant(owner_id,report_id,revision,recipient_username,ttl_hours,baseline)；baseline严格完整四段，已有override必须逐字一致；其余为所有者确认的客户端规则基线，不称服务端认证。单事务校验启用、角色、归属、修订/期限/撤销/配额；每报告10份、每账号创建或接收共100份历史（独立于只读）。
- AdvisorEditService(db,clock=time.time)：create_grant/list_for_report/revoke/list_for_user/read/apply/list_audit。read返回{grant,report,baseline}；apply(recipient_id,grant_id,revision,changes)返回{report,changed_sections,audit_id}（全无操作[]/null）。无效授权404，匹配有效授权但修订不一致409，格式422，容量413，损坏503隐藏私文。
- 事务内构造新归档，只改advisor.sections/history/lastAuthor和record.updatedAt，原state/reportMeta/版本/id/createdAt不改。历史最多200，账户2M UTF16限额、MAX_SAFE修订保护，CAS；授权检查与写入/服务端审计同一事务，任何失败全部回滚。
- 便携history作者固定学校顾问，并增加严格可选actor：{kind:school_advisor,user_id:UUID,username:规范3–64账号,grant_id:UUID,source_revision:正安全整数,result_revision:source+1}，action=edit。来源不是AI origin。原旧备份兼容、恢复/携带保留；便携字段可被原所有者备份/重新上传修改，不能称防篡改凭证。
- 新增服务端只追加审计advisor_edits：id/owner_id/report_id/grant_id/actor_id/actor_username/source_revision/result_revision/created_at/changes_json，changes逐段{section,before,after}。操作者从事务内登录ID查询，忽略/拒绝客户端author等字段。owner GET返回{items:[{id,grant_id,report_id,actor_id,actor_username,source_revision,result_revision,created_at,changes}]}。接收账号删除后保留审计；原报告/所有者删除时级联删除。没有修改/删除审计接口，数据库操作员仍可改库，不称不可篡改。

## API与页面

POST/GET /api/reports/{id}/advisor-edit-access；DELETE /api/reports/{id}/advisor-edit-access/{grant_id}；GET /api/reports/{id}/advisor-edits（所有者）；GET /api/advisor-edit-access；GET /api/advisor-edit-access/{grant_id}；PUT /api/advisor-edit-access/{grant_id}。POST体{revision,recipient_username,ttl_hours,scope,baseline}；PUT体{revision,changes}，不接受完整record/author。GET/写沿用Cookie、页面CSRF身份绑定、Origin/写CSRF。健康API2。

主页面新AdvisorEditOwner.init({client,run,message})，clear/setReport/setBusy，独立IDs editRecipient/editTtl/editPreviewBtn/editCreateBtn/editListBtn/editAuditBtn/editOwnerPreview/editOwnerList/editOwnerAudit；撤销data-edit-revoke。客户方法createAdvisorEditAccess/listAdvisorEditAccess/revokeAdvisorEditAccess/listAdvisorEditable/readAdvisorEditable/applyAdvisorEdit/listAdvisorAudit。

独立advisor-edit.html/js/advisor-edit.js/css/advisor-edit.css，仅主动连接/登录/刷新/选择/编辑选段/预览/确认提交。无浏览器存储、本机库/上传/分享/AI操作；只读teacher.html不改变。IDs editConnectBtn/editDisconnectBtn/editConnectPanel/editLoginForm/editUsername/editPassword/editWorkspace/editAccount/editRefreshBtn/editLogoutBtn/editStatus/editList/editDetail/editHeading/editNote/editReport/editFields/editPreviewChangesBtn/editSubmitBtn/editChangesPreview。名单data-edit-read。生成textarea/checkbox data-edit-section/data-edit-select。版本不匹配拒绝视图。授权到期/撤销/修订/会话变化清私密；临时网络失败仍保留本人未提交草稿供复制但禁写，断开/换账号/离开清全部。输入改变清预览，CAS冲突不自动重试覆盖；不确定写响应保留本人草稿且不重试，明确状态核对后重授。

## 迁移与验证

schema5追加advisor_edit_grants及advisor_edits和索引，精确已知1/2/3/4事务升级，保留全部旧表/行/密码/会话/分享/批注/teacher_grants，失败回滚、未知拒绝。任何初始化入口前停服务、私有一致备份并保留匹配旧源码，回退恢复旧备份且保留新库，不能手改版本。

先运行新增失败测试，再实现。分工：数据库/服务/迁移，便携actor契约，独立页面/owner UI并行；主协调接API/协议/宿主/真实集成。最终独立审查尤其检查权限竞态、单事务写/审计、旧只读不能写、客户端无法伪造actor/before、持久化/迟到响应/网络不确定、配额和旧数据迁移。完整Node/Python/真实API回归后提交fork/更新草稿PR，打包解压验证，更新台账与heartbeat。
