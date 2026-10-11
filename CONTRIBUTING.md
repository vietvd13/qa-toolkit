# Đóng góp

Cảm ơn bạn muốn góp sức. Tài liệu này dành cho người sửa code hoặc viết thêm công cụ.

## Chuẩn bị

```bash
git clone <repo>
cd <repo>
npm install
```

Nạp extension để thử: `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `extension/`. Sửa code xong, bấm nút tải lại ⟳ của extension rồi tải lại tab bộ công cụ.

`npm install` tự cài hook git (husky): mỗi lần commit sẽ chạy `npm run verify` và kiểm tra lời nhắn commit. Có thể tự chạy bất cứ lúc nào:

```bash
npm run verify
```

## Thêm một công cụ mới

1. Chép `extension/tools/_template` thành `extension/tools/<id>`. `id` viết thường, nối bằng gạch ngang, vd `so-sanh-csv`.
2. Viết giao diện trong `index.html`, code trong `app.js`. CSS riêng (nếu cần) để trong `style.css`.
3. Thêm một mục vào `extension/tools/registry.js`:
   ```js
   { id: 'so-sanh-csv', name: 'So sánh CSV', icon: 'difference', desc: 'Một câu nói rõ công cụ làm gì.', tags: ['Dữ liệu'], path: 'tools/so-sanh-csv/index.html' }
   ```
4. Nếu cần quyền Chrome mới (`downloads`, `storage`, …), thêm vào `permissions` trong `extension/manifest.json` và ghi rõ lý do trong Pull Request.
5. Thêm dòng mô tả vào mục *Chưa phát hành* của [CHANGELOG.md](CHANGELOG.md).

## Quy ước

**Giao diện**
- Dùng thành phần có sẵn trong `shared/theme.css`: `.card`, `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger`, `.tabs`, `.chip`, `.badge-*`, `.table-wrap`, `.modal`…
- Chỉ dùng biến màu (`var(--primary-strong)`, `var(--surface)`, `var(--text-secondary)`, `var(--success)`…), không viết mã màu cứng. Có vậy chế độ tối và màu tự chọn mới hoạt động.
- Trạng thái không chỉ dựa vào màu: luôn kèm chữ hoặc icon (✓, ✗, "Thiếu"…).
- Icon dùng [Google Material Symbols](https://fonts.google.com/icons): `<span class="ms" aria-hidden="true">tên_icon</span>`.
- Kiểm tra ở cả giao diện sáng và tối, và ở màn hình hẹp.

**Code**
- Manifest V3 không cho `<script>` viết thẳng trong HTML hay thuộc tính `onclick`. Mọi code để trong file `.js`. `npm run check` sẽ báo nếu vi phạm.
- Chữ hiển thị cho người dùng viết bằng tiếng Việt, rõ ràng, dành cho người không rành kỹ thuật.
- Không commit link affiliate, dữ liệu khách hàng hay file trong `results/`.

## Quy tắc commit

Repo dùng chuẩn [Conventional Commits](https://www.conventionalcommits.org/vi/v1.0.0/). Lời nhắn commit được kiểm tra tự động khi commit (husky + commitlint) và trên mỗi Pull Request (GitHub Actions). Commit sai quy tắc sẽ bị chặn.

### Cấu trúc

```
<loại>(<phạm vi>): <mô tả ngắn>

<thân — không bắt buộc: vì sao thay đổi, ảnh hưởng gì>

<chân — không bắt buộc: Closes #12, BREAKING CHANGE: …>
```

- **Mô tả** viết tiếng Việt, **chữ thường ở đầu**, không có dấu chấm cuối, tối đa 100 ký tự cả dòng. Viết như một mệnh lệnh: "thêm…", "sửa…", không phải "đã thêm…".
- **Phạm vi** không bắt buộc, nhưng nên ghi để biết commit chạm vào phần nào.
- Mỗi commit một thay đổi có ý nghĩa. Đừng gộp sửa lỗi với thêm tính năng.

### Loại

| Loại | Dùng khi | Ảnh hưởng phiên bản |
|---|---|---|
| `feat` | Thêm tính năng, thêm công cụ | tăng **minor** (1.**3**.0) |
| `fix` | Sửa lỗi | tăng **patch** (1.2.**1**) |
| `perf` | Chạy nhanh hơn, nhẹ hơn | patch |
| `refactor` | Sắp xếp lại code, không đổi hành vi | — |
| `style` | Định dạng code (khoảng trắng, dấu chấm phẩy), **không** phải đổi giao diện | — |
| `docs` | Chỉ sửa tài liệu | — |
| `test` | Thêm/sửa kiểm thử | — |
| `build` | Đóng gói, script build, thư viện | — |
| `ci` | GitHub Actions | — |
| `chore` | Việc lặt vặt khác (cấu hình, dọn dẹp) | — |
| `revert` | Hoàn tác một commit trước | — |

Thay đổi không tương thích ngược (vd đổi cấu trúc `registry.js` khiến tool cũ hỏng): thêm `!` sau loại hoặc phạm vi (`feat(hub)!: …`), kèm dòng `BREAKING CHANGE: …` ở chân. Phiên bản tăng **major** (**2**.0.0).

### Phạm vi

| Phạm vi | Phần |
|---|---|
| `hub` | Khung bộ công cụ: đầu trang, thanh bên, danh mục |
| `theme` | Hệ màu, giao diện dùng chung (`extension/shared/`) |
| `template` | Khung mẫu `extension/tools/_template` |
| `ext` | `manifest.json`, quyền, icon, đóng gói extension |
| `web` | Bản web (`node/server.js`, `node/redirect-engine.js`) |
| `cli` | Bản dòng lệnh (`node/trace.js`) |
| `console` | Script dán vào Console (`extras/`) |
| `deps` · `ci` · `docs` · `release` | Thư viện · GitHub Actions · tài liệu · phát hành |
| `<id công cụ>` | Một công cụ cụ thể, vd `redirect`. Tự có khi thêm công cụ vào `registry.js` |

### Ví dụ

```text
feat(redirect): thêm bộ lọc theo affiliate_id
fix(hub): ô tìm kiếm không mở công cụ khi bấm Enter
feat(so-sanh-csv): thêm công cụ so sánh hai file CSV
perf(redirect): giảm thời gian chờ khi đã tìm đủ tham số
refactor(theme): gom biến bo góc vào thang --radius-*
docs: bổ sung hướng dẫn cài đặt cho Edge
build(deps): nâng playwright lên 1.65
chore(release): 1.3.0
```

Không hợp lệ: `Thêm tính năng mới` (thiếu loại), `Feat: thêm…` (loại viết hoa), `feat(abc): …` (phạm vi không có trong danh sách), `fix: sửa lỗi.` (dấu chấm cuối).

### Mẫu commit

Dùng mẫu có sẵn để khỏi nhớ quy tắc (chạy một lần trong repo):

```bash
git config commit.template .gitmessage
```

Sau đó `git commit` (không kèm `-m`) sẽ mở trình soạn thảo với gợi ý sẵn.

### Pull Request

- Mỗi Pull Request một việc. Mô tả thay đổi gì và vì sao, đổi giao diện thì kèm ảnh chụp.
- **Tiêu đề Pull Request cũng theo quy tắc trên**, vì khi gộp bằng *Squash and merge*, tiêu đề này trở thành lời nhắn commit trên `main`.

## Phát hành (dành cho người quản lý repo)

```bash
npm version patch|minor|major   # đồng bộ phiên bản package.json + manifest.json, tạo tag
git push --follow-tags          # GitHub Actions tạo Release kèm file .zip
```

Trước khi phát hành, chuyển mục *Chưa phát hành* trong CHANGELOG thành phiên bản mới.
