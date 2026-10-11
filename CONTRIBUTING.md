# Đóng góp

Cảm ơn bạn muốn góp sức. Tài liệu này dành cho người sửa code hoặc viết thêm công cụ.

## Chuẩn bị

```bash
git clone <repo>
cd <repo>
npm install
```

Nạp extension để thử: `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục `extension/`. Sửa code xong, bấm nút tải lại ⟳ của extension rồi tải lại tab bộ công cụ.

Trước khi commit, chạy:

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

**Commit & Pull Request**
- Mỗi Pull Request một việc, mô tả thay đổi gì và vì sao. Đổi giao diện thì kèm ảnh chụp.
- Tiêu đề commit ngắn, động từ đứng đầu, vd `Thêm công cụ So sánh CSV`, `Sửa lỗi lọc theo nhóm`.

## Phát hành (dành cho người quản lý repo)

```bash
npm version patch|minor|major   # đồng bộ phiên bản package.json + manifest.json, tạo tag
git push --follow-tags          # GitHub Actions tạo Release kèm file .zip
```

Trước khi phát hành, chuyển mục *Chưa phát hành* trong CHANGELOG thành phiên bản mới.
