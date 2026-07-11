# --Obsidian Halo 插件运行机制说明

本文档面向二次开发，说明这个 Obsidian 插件如何把当前笔记发布到 Halo，以及各模块之间的职责和主要数据流。

## 项目概览

这是一个标准 Obsidian 社区插件项目。插件入口是 `src/main.ts`，构建后输出根目录下的 `main.js`，由 `manifest.json` 指定给 Obsidian 加载。

主要依赖：

- `obsidian`：插件 API、命令、设置页、Modal、Vault 文件读写、HTTP 请求 `requestUrl`。
- `@halo-dev/api-client`：提供 Halo 资源类型定义，例如 `Post`、`Content`、`Attachment`、`Category`、`Tag`。
- `markdown-it` 和 `markdown-it-anchor`：把 Markdown 原文渲染为 Halo 需要的 HTML 内容。
- `transliteration`：生成文章、分类、标签 slug。
- `i18next`：国际化文案。
- `@rslib/core`：打包插件，配置在 `rslib.config.ts`。
- `@rstest/core`：测试框架。

常用命令：

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run test
pnpm run check
```

`rslib.config.ts` 会把 `src/main.ts` 打包成 CommonJS 格式的 `main.js`，并将 Obsidian、Electron、CodeMirror、Node 内置模块作为外部依赖，不打进包里。

## 核心文件职责


| 文件                          | 职责                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                 | 插件生命周期入口；初始化 i18n、读取设置、注册图标、注册命令、挂载设置页；协调发布、上传图片、更新和拉取流程。 |
| `src/service/index.ts`        | 核心业务服务；负责调用 Halo API、发布文章、更新文章、拉取文章、上传图片、管理图片缓存、分类和标签映射。       |
| `src/settings.ts`             | 设置模型、默认设置、站点 URL 规范化、设置页 UI。                                                              |
| `src/sites-modal.ts`          | 站点管理 Modal，支持添加、编辑、删除、设置默认站点。                                                          |
| `src/site-editing-modal.ts`   | 单个站点编辑 Modal，支持填写站点名、URL、个人令牌、默认状态，并验证令牌权限。                                 |
| `src/site-selection-modal.ts` | 发布或上传图片前选择目标 Halo 站点。                                                                          |
| `src/post-selection-model.ts` | 从 Halo 远端文章列表中选择一篇文章并拉取到本地。                                                              |
| `src/utils/markdown.ts`       | 配置 Markdown 渲染器。                                                                                        |
| `src/utils/id.ts`             | 生成类 UUID 的随机字符串，用作 Halo 新文章名和 multipart boundary。                                           |
| `src/i18n/*`                  | 多语言文案资源。                                                                                              |
| `tests/*`                     | 单元测试，重点覆盖设置 URL 规范化、图片上传、缓存、更新远端文章、发布重试。                                   |

## 插件加载过程

`HaloPlugin.onload()` 是插件启动入口，流程如下：

1. 初始化 `i18next`，语言使用 Obsidian 的 `moment.locale()`，兜底为英文。
2. 调用 `loadSettings()` 读取插件持久化数据，并用 `DEFAULT_SETTINGS` 补齐默认值。
3. 调用 `addHaloIcon()` 注册 Halo ribbon 图标。
4. 注册左侧 Ribbon 图标，点击后执行 `publishCommand()`。
5. 注册 5 个 Obsidian 命令。
6. 注册设置页 `HaloSettingTab`。

插件没有在 `onunload()` 中释放额外资源。

## 设置数据结构

设置定义在 `src/settings.ts`。

```ts
interface HaloSite {
  name: string;
  url: string;
  token: string;
  default: boolean;
}

interface HaloSetting {
  sites: HaloSite[];
  publishByDefault: boolean;
  replaceImageLinks: boolean;
  imageUploadCache: Record<string, Record<string, ImageUploadCacheEntry>>;
}
```

含义：

- `sites`：配置的 Halo 站点列表，支持多个站点。
- `publishByDefault`：首次创建文章时，是否默认发布，而不是仅创建草稿。
- `replaceImageLinks`：上传图片成功后，是否把本地 Markdown 中的图片链接替换为 Halo 远程地址。关闭时，发布到 Halo 的内容仍使用远程图片地址，但本地笔记尽量保持本地链接。
- `imageUploadCache`：图片上传缓存，按站点 URL 和本地文件路径分组。

站点 URL 会通过 `normalizeSiteUrl()` 处理：去掉首尾空白和结尾 `/`。站点匹配使用 `isSameSiteUrl()`，因此 `https://example.com/` 和 `https://example.com` 被认为相同。

## 注册的命令

`src/main.ts` 注册以下命令：


| 命令 ID                 | 中文名称                    | 行为                                                                                                  |
| ----------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| `publish`               | 发布到 Halo                 | 发布当前打开的笔记；如果已发布过，使用 frontmatter 中的`halo.site` 找回对应站点；否则让用户选择站点。 |
| `publish-with-defaults` | 发布到 Halo（使用默认配置） | 使用设置中的默认站点发布当前笔记。                                                                    |
| `upload-images`         | 上传图片到 Halo             | 只上传当前笔记中的本地图片，并按设置决定是否替换本地 Markdown 链接。                                  |
| `update-post`           | 从 Halo 更新内容            | 根据当前笔记 frontmatter 中的`halo.name` 从 Halo 拉取远端内容，覆盖当前文件正文并刷新 frontmatter。   |
| `pull-post`             | 从 Halo 拉取文档            | 选择站点和远端文章，新建一个本地 Markdown 文件。                                                      |

左侧 Ribbon 图标执行的是 `publish` 同一套逻辑。

## Frontmatter 约定

插件通过 Obsidian 的 `metadataCache.getFileCache(file)?.frontmatter` 读取 YAML frontmatter，并在发布、更新、拉取后通过 `fileManager.processFrontMatter()` 写回。

支持的字段：

```yaml
title: 文章标题
slug: post-slug
excerpt: 摘要
cover: https://example.com/cover.png
categories:
  - 分类显示名
tags:
  - 标签显示名
halo:
  site: https://halo.example.com
  name: post-resource-name
  publish: true
```

字段说明：

- `title`：映射到 `post.spec.title`。新文章没有设置时默认使用当前文件名。
- `slug`：映射到 `post.spec.slug`。新文章没有设置时由标题生成。
- `excerpt`：映射到 `post.spec.excerpt.raw`，并关闭自动摘要。
- `cover`：映射到 `post.spec.cover`。
- `categories`：使用分类显示名。发布时会转换为 Halo 分类资源名；不存在的分类会自动创建。
- `tags`：使用标签显示名。发布时会转换为 Halo 标签资源名；不存在的标签会自动创建。
- `halo.site`：绑定文章所属站点，用于后续更新和避免误发到其他站点。
- `halo.name`：Halo 文章资源名。存在时发布会走更新远端文章逻辑，不存在时创建新文章。
- `halo.publish`：显式控制发布或取消发布。字段存在且为 `true` 会发布，存在且为 `false` 会取消发布。字段不存在时，新文章只在 `publishByDefault` 为 `true` 时发布。

发布成功后，插件会用远端最终状态回写 `title`、`slug`、`cover`、`excerpt`、`categories`、`tags` 和 `halo`。

## 发布流程

发布由 `HaloPlugin.publishCommand()` 或 `publish-with-defaults` 触发，真正的发布逻辑在 `HaloService.publishPost()`。

整体流程：

1. 检查当前是否有活动编辑器和文件。
2. 判断当前文件是否已有 `halo.site`。
3. 如果已有 `halo.site`，必须匹配已配置站点，否则提示错误。
4. 如果没有 `halo.site`，根据命令选择默认站点或弹出站点选择 Modal。
5. 发布前先调用 `uploadImagesForPublish()` 上传本地图片。
6. 图片上传失败时中止发布。
7. 调用 `service.publishPost({ markdown: uploadResult.markdown })` 发布。

`uploadImagesForPublish()` 的一个重要细节是：它用 `silent: true` 调用图片上传，并把上传后的 Markdown 字符串传给发布流程。这样即使 `replaceImageLinks` 关闭，发布到 Halo 的内容仍然能使用远程图片地址，同时本地文件不会被强制替换。

`HaloService.publishPost()` 内部流程：

1. 读取当前文件内容，或者使用调用方传入的 `markdown`。
2. 通过 `frontmatterPosition` 去掉 YAML frontmatter，只取正文作为 Halo 原文。
3. 检查 `halo.site` 是否与当前服务站点匹配。
4. 把 frontmatter 中的分类、标签显示名转换为 Halo 资源名，必要时自动创建分类和标签。
5. 如果存在 `halo.name`：
   - 获取最新远端 `Post` 资源，避免基于旧版本更新。
   - 使用 frontmatter 覆盖远端文章的可编辑字段。
   - `PUT /apis/uc.api.content.halo.run/v1alpha1/posts/{name}` 更新文章资源。
   - 获取草稿 snapshot。
   - 将 Markdown 原文和渲染后的 HTML 写入草稿 annotation。
   - `PUT /apis/uc.api.content.halo.run/v1alpha1/posts/{name}/draft` 更新草稿。
6. 如果不存在 `halo.name`：
   - 创建一个新的 `Post` 对象，`metadata.name` 使用 `randomUUID()`。
   - 根据 frontmatter 和文件名填充文章字段。
   - 在 `metadata.annotations["content.halo.run/content-json"]` 写入内容 JSON。
   - `POST /apis/uc.api.content.halo.run/v1alpha1/posts` 创建文章。
7. 根据 `halo.publish` 或 `publishByDefault` 调用发布或取消发布接口。
8. 再次读取远端文章最终状态。
9. 将远端状态回写到本地 frontmatter。

更新远端已存在文章时包了一层 `withPublishRetry()`，最多重试 3 次，重试间隔依次为 500ms、1000ms、1500ms。测试中说明这是为了处理草稿锁或版本竞争一类的临时失败：每次重试会重新获取最新远端文章版本后再更新。

## Markdown 到 Halo 内容的转换

`HaloService.createPostContent()` 返回 Halo `Content`：

```ts
{
  content: markdownIt.render(raw),
  raw,
  rawType: "markdown"
}
```

其中：

- `raw` 是去掉 frontmatter 后的 Markdown 正文。
- `content` 是 `markdown-it` 渲染出的 HTML。
- `rawType` 默认是 `markdown`；更新已有草稿时会沿用远端 snapshot 的 `rawType`。

`markdown-it` 配置：

- `html: true`
- `xhtmlOut: true`
- `breaks: true`
- `linkify: true`
- `typographer: true`
- 启用 `markdown-it-anchor`

## 图片上传流程

图片上传逻辑在 `HaloService.uploadImages()`。

支持两种图片写法：

```markdown
![alt](images/logo.png)
![[images/banner.png|Hero]]
```

处理规则：

1. 读取当前文件 Markdown。
2. 调用 `collectLocalImageReferences()` 收集本地图片引用。
3. 跳过远程路径，例如 `https://...`、`//cdn...`、`#anchor`、任意带协议的路径。
4. 对 Markdown 图片链接：
   - 支持普通路径。
   - 支持 `<path with spaces.png>`。
   - 会尝试 URL decode。
5. 对 Wiki embed：
   - 使用 Obsidian `getLinkpath()` 取真实路径。
   - 保留 alias，例如 `![[a.png|Hero]]` 上传后变成 `![Hero](remote-url)`。
6. 解析图片文件时依次尝试：
   - `metadataCache.getFirstLinkpathDest()`。
   - 从 Vault 根目录按路径找。
   - 按当前笔记所在目录做相对路径找。
7. 同一个文件在一次上传中只上传一次。
8. 如果缓存命中且文件大小、mtime 未变化，复用旧 permalink。
9. 否则读取二进制文件，构造 multipart body，上传到 Halo 附件接口。
10. 根据 `replaceImageLinks` 和参数决定是否修改本地 Markdown。

上传接口：

```text
POST /apis/uc.api.storage.halo.run/v1alpha1/attachments/-/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data; boundary=...
```

成功后从 `attachment.status.permalink` 取图片地址。如果返回相对路径，会拼接当前站点 URL。

支持的图片扩展名：

```text
avif, bmp, gif, ico, jpeg, jpg, png, svg, tif, tiff, webp
```

## 图片缓存机制

缓存结构：

```ts
imageUploadCache[site.url][file.path] = {
  filePath,
  linkType,
  size,
  mtime,
  permalink,
  updatedAt,
  wikiAlias
}
```

缓存命中条件：

- 当前站点 URL 相同。
- 本地文件路径相同。
- 文件大小 `size` 相同。
- 文件修改时间 `mtime` 相同。

缓存的作用：

- 避免重复上传同一张未变化的图片。
- 在 `replaceImageLinks` 关闭时，从 Halo 更新文章后，可以把远程图片链接恢复成本地图片链接。

当远端内容包含曾经上传过的图片 URL，`restoreCachedLocalImageLinks()` 会根据缓存反查本地文件：

- 如果缓存记录来自 Markdown 图片，则把远程 URL 替换回本地路径。
- 如果缓存记录来自 Wiki embed，则恢复成 `![[本地路径|alias]]`。
- 如果本地文件不存在、扩展名不是图片、大小或 mtime 已变化，则不会恢复。

## 从 Halo 更新当前文章

命令 `update-post` 的流程：

1. 当前文件必须有 `halo.site`，否则认为还未发布。
2. 根据 `halo.site` 找到本地配置的站点。
3. `HaloService.updatePost()` 读取当前文件的 `halo.name`。
4. 调用 `getPost(name)` 获取远端文章资源和草稿内容。
5. 根据远端分类、标签资源名查询显示名。
6. 用远端 Markdown 原文覆盖当前本地文件正文。
7. 如果 `replaceImageLinks` 关闭，则尝试根据图片缓存恢复本地图片链接。
8. 回写 frontmatter。

相关接口：

```text
GET /apis/uc.api.content.halo.run/v1alpha1/posts/{name}
GET /apis/uc.api.content.halo.run/v1alpha1/posts/{name}/draft?patched=true
```

`getPost()` 从 draft snapshot 的 annotations 里读取：

- `content.halo.run/patched-content`
- `content.halo.run/patched-raw`

并组装成 `Content`。

## 从 Halo 拉取新文档

命令 `pull-post` 的流程：

1. 如果没有配置站点，提示错误。
2. 如果只有一个站点，直接使用；多个站点则打开站点选择 Modal。
3. 打开文章选择 Modal，请求远端文章列表。
4. 用户选择一篇文章后，调用 `HaloService.pullPost(name)`。
5. 创建本地文件 `${post.post.spec.title}.md`，内容为远端 Markdown 原文。
6. 打开新文件。
7. 回写 frontmatter，绑定 `halo.site` 和 `halo.name`。

文章列表接口：

```text
GET /apis/uc.api.content.halo.run/v1alpha1/posts?labelSelector=content.halo.run%2Fdeleted%3Dfalse
```

当前实现没有处理同名文件冲突。如果远端标题对应的本地文件已存在，`vault.create()` 可能失败；二次开发时可以考虑补齐文件名去重逻辑。

## 站点管理与令牌验证

设置页入口在 `HaloSettingTab.display()`：

- Halo 站点：打开 `HaloSitesModal` 管理站点列表。
- 默认发布文章：控制 `publishByDefault`。
- 替换图片链接：控制 `replaceImageLinks`。

站点编辑在 `SiteEditingModal`：

- 站点名称。
- 站点 URL。
- 个人令牌。
- 是否默认站点。
- 验证按钮。

验证接口：

```text
GET /apis/api.console.halo.run/v1alpha1/users/-/permissions
Authorization: Bearer <token>
```

验证逻辑只检查返回的 `uiPermissions` 是否包含 `uc:posts:manage`。这说明发布文章至少需要文章管理相关权限；图片上传、分类和标签创建也依赖同一个令牌访问 Halo API。

## Halo API 清单


| 用途         | 方法与路径                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------- |
| 获取文章资源 | `GET /apis/uc.api.content.halo.run/v1alpha1/posts/{name}`                                           |
| 获取文章草稿 | `GET /apis/uc.api.content.halo.run/v1alpha1/posts/{name}/draft?patched=true`                        |
| 创建文章     | `POST /apis/uc.api.content.halo.run/v1alpha1/posts`                                                 |
| 更新文章资源 | `PUT /apis/uc.api.content.halo.run/v1alpha1/posts/{name}`                                           |
| 更新文章草稿 | `PUT /apis/uc.api.content.halo.run/v1alpha1/posts/{name}/draft`                                     |
| 发布文章     | `PUT /apis/uc.api.content.halo.run/v1alpha1/posts/{name}/publish`                                   |
| 取消发布文章 | `PUT /apis/uc.api.content.halo.run/v1alpha1/posts/{name}/unpublish`                                 |
| 文章列表     | `GET /apis/uc.api.content.halo.run/v1alpha1/posts?labelSelector=content.halo.run%2Fdeleted%3Dfalse` |
| 分类列表     | `GET /apis/content.halo.run/v1alpha1/categories`                                                    |
| 创建分类     | `POST /apis/content.halo.run/v1alpha1/categories`                                                   |
| 标签列表     | `GET /apis/content.halo.run/v1alpha1/tags`                                                          |
| 创建标签     | `POST /apis/content.halo.run/v1alpha1/tags`                                                         |
| 上传附件     | `POST /apis/uc.api.storage.halo.run/v1alpha1/attachments/-/upload`                                  |
| 验证权限     | `GET /apis/api.console.halo.run/v1alpha1/users/-/permissions`                                       |

除上传附件外，多数请求使用：

```http
Content-Type: application/json
Authorization: Bearer <token>
```

上传附件只带 `Authorization` 和 multipart 的 `Content-Type`。

## 关键设计细节

### 文章绑定通过 frontmatter 完成

插件不维护独立的“本地文件到远端文章”数据库。文章是否已发布、发布到哪个站点、远端资源名是什么，都写在当前 Markdown 文件 frontmatter 的 `halo` 字段里。

优点是可迁移、可读、便于手动修改；缺点是用户删除或改错 `halo` 字段后，插件无法可靠识别远端文章。

### 分类和标签使用显示名

本地 frontmatter 中的 `categories` 和 `tags` 存的是 Halo 显示名，不是资源名。发布时会查询 Halo 现有分类和标签：

- 找到显示名相同的资源就使用其 `metadata.name`。
- 找不到就创建新分类或标签。

更新和拉取时则反向查询，把远端资源名转换回显示名写入 frontmatter。

### 发布前图片上传失败会阻止发布

`publish` 和 `publish-with-defaults` 都会先上传本地图片。如果有任意图片上传失败，插件提示失败数量并中止发布，避免 Halo 文章中出现部分无效本地图片路径。

### 更新远端文章会先获取最新资源

更新已有文章时，每次尝试都会先 `GET` 最新 `Post`，再 `PUT`。这样可以带上远端最新版本信息，减少版本冲突。

### 本地替换图片链接和发布内容可以分离

`replaceImageLinks = false` 时，本地笔记可以保留 `![[local.png]]` 或 `![alt](local.png)`，但发布内容仍使用上传后的远程 URL。这一点通过 `uploadImages({ silent: true })` 返回的 `markdown` 参数实现。

## 测试覆盖情况

当前测试集中在：

- URL 规范化和站点 URL 比较。
- 本地 Markdown 图片和 Wiki 图片上传。
- 跳过远程图片链接。
- 处理带空格和 URL 编码的图片路径。
- `replaceImageLinks = false` 时不修改本地文件，但返回远程链接 Markdown。
- 复用有效图片缓存，忽略过期缓存。
- 有图片上传失败时不写入部分替换后的本地 Markdown。
- 从 Halo 更新文章时，根据缓存恢复本地图片链接。
- 发布已有文章时，草稿更新失败会重试并重新获取最新远端文章。
- `publishPost({ markdown })` 使用传入内容，不重新读取本地文件。

## 二次开发建议

优先从以下位置切入：

- 新增命令或改变命令流程：修改 `src/main.ts`。
- 改 Halo API、发布字段、文章同步策略：修改 `src/service/index.ts`。
- 新增插件设置：修改 `src/settings.ts` 的接口、默认值和设置页，同时检查 `loadSettings()` 的兼容补齐。
- 新增站点字段或认证方式：修改 `HaloSite`、站点 Modal、`HaloService` 构造函数中的 headers。
- 调整图片上传规则：修改 `collectLocalImageReferences()`、`resolveImageFile()`、`uploadImage()` 和缓存相关方法。
- 调整 Markdown 渲染：修改 `src/utils/markdown.ts`。
- 调整远端文章选择 UI：修改 `src/post-selection-model.ts`。

建议补强的点：

- `pullPost()` 处理同名文件冲突。
- 远端文章列表增加分页、搜索或按状态过滤。
- 发布和上传图片增加更明确的错误提示，目前多数异常只显示通用失败。
- 站点保存前校验 URL、token 是否为空。
- 图片上传缓存可提供清理按钮，避免设置数据长期增长。
- `randomUUID()` 可以替换为更强的 UUID 实现，减少极小概率冲突。
- 分类和标签匹配目前只按显示名精确匹配，可考虑大小写、slug 或别名策略。
- 支持更多 Halo 文章字段，例如可见性、置顶、模板、发布时间、允许评论、优先级、HTML meta。

## 推荐阅读顺序

二次开发前建议按下面顺序阅读源码：

1. `src/main.ts`：先理解插件入口、命令和站点选择逻辑。
2. `src/settings.ts`：理解设置数据形状。
3. `src/service/index.ts`：重点看 `publishPost()`、`uploadImages()`、`updatePost()`、`pullPost()`。
4. `tests/service/index.test.ts`：通过测试用例理解边界行为。
5. 各 Modal 文件：理解设置和选择 UI。



---


# todolist


- [ ]  我希望，拓展图片上传方式，增加图片上传到openlist的选项
