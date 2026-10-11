# Bộ công cụ — Chrome extension

Kho công cụ hỗ trợ test, gói trong một extension. Không cần cài Node hay chạy server.

| Công cụ | Làm gì |
|---|---|
| **Kiểm tra Redirect** | Mở một link nhiều lần, ghi lại từng link nó đi qua (302, JavaScript, meta refresh, mở app) và chỉ ra `sub3`, `sub4`, `Sub_id`, `affiliate_id`, `utm_content` nằm ở link nào. |

## Cài đặt

1. Mở Chrome (hoặc Edge, Cốc Cốc), vào `chrome://extensions`.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) rồi chọn thư mục `extension` này.
4. Ghim icon **Bộ công cụ** lên thanh công cụ cho tiện.

Khi có bản mới: chép đè thư mục `extension`, rồi bấm nút tải lại (⟳) của extension trong `chrome://extensions`.

## Sử dụng

- Bấm icon extension, bộ công cụ mở trong tab mới. Thanh bên trái liệt kê các công cụ.
- Mỗi công cụ chạy riêng. Đang chạy dở một cái vẫn chuyển sang cái khác được, quay lại kết quả vẫn còn. Công cụ đang chạy có chấm nhấp nháy ở thanh bên.

### Giao diện

Bấm **Giao diện** ở cuối thanh bên:

- **Chế độ màu:** Theo hệ thống (tự đổi khi máy chuyển sáng/tối), Sáng, hoặc Tối.
- **Màu chủ đạo** (nút chính, mục đang chọn, thanh tiến độ) và **màu phụ** (nhãn, biểu đồ tỉ lệ): chọn màu có sẵn, bấm ô cầu vồng để chọn tự do, hoặc gõ mã màu `#RRGGBB`.
- Tool tự tính các sắc độ còn lại và tự chỉnh đậm hơn nếu màu quá nhạt khiến chữ khó đọc. Bảng **Độ dễ đọc** cho biết từng cặp màu có đạt chuẩn 4.5:1 không.
- Đổi là áp dụng ngay cho mọi công cụ. Cài đặt lưu trên máy, không ảnh hưởng người khác.

Hệ màu mặc định: *Feminine Work OS* (`shared/theme.css`). Trong giao diện sáng, chữ và nút dùng rose-600 `#AD4168` thay vì rose-500 `#C6537B` vì rose-500 chỉ đạt 4.26:1 với chữ trắng.

### Lưu ý với Kiểm tra Redirect

- Extension mở link trong một cửa sổ Chrome nhỏ riêng. Cửa sổ tự đóng khi xong; đóng nó giữa chừng thì tool dừng.
- Link được mở bằng chính Chrome và IP của bạn, nên kết quả sát với người dùng thật.
- Các lượt dùng chung cookie với trình duyệt. Muốn mỗi lượt như người mới, bật **Xoá cookie của các link đã đi qua** trong *Tuỳ chọn nâng cao*. Cách này sẽ đăng xuất bạn khỏi các trang đó (vd Shopee).
- "Điện thoại" chỉ đổi User-Agent gửi lên máy chủ. JavaScript trên trang vẫn thấy trình duyệt máy tính.
- Mở link affiliate rất nhiều lần có thể bị nền tảng tính là click ảo. Nên kiểm tra với số lượt vừa đủ.

## Thêm công cụ mới (dành cho người viết tool)

1. Chép thư mục `tools/_template` thành `tools/<id>` (vd `tools/so-sanh-csv`).
2. Sửa `index.html` và `app.js` trong thư mục mới.
   - Giao diện dùng chung nằm ở `shared/theme.css` (màu, chữ, nút, ô nhập, tab, bảng, tooltip, cửa sổ) và `shared/theme.js` (sáng/tối + màu tự chọn). Trang mới phải nạp cả hai trong `<head>`.
   - Chỉ dùng biến màu (`var(--primary-strong)`, `var(--surface)`, `var(--text-secondary)`…), không viết mã màu cứng, để chế độ tối và màu tự chọn hoạt động.
   - Icon dùng bộ Google Material Symbols: `<span class="ms">tên_icon</span>`, tên tra ở https://fonts.google.com/icons.
   - Extension không cho viết `<script>` trong HTML, mọi code để trong file `.js`.
3. Thêm một dòng vào `tools/registry.js` (id, tên, icon, mô tả, đường dẫn).
4. Nếu tool cần quyền Chrome mới (vd `downloads`, `storage`), thêm vào `permissions` trong `manifest.json`.
5. Tải lại extension trong `chrome://extensions`.

## Cấu trúc

```
extension/
  manifest.json        khai báo extension + quyền
  background.js        bấm icon → mở hub.html
  hub.html/.css/.js    khung bộ công cụ (thanh bên, trang chủ)
  shared/              giao diện dùng chung (theme.css, theme.js, embed.js)
  tools/
    registry.js        danh sách công cụ
    _template/         khung để tạo tool mới
    redirect/          Kiểm tra Redirect (index.html, style.css, app.js, engine.js)
  icons/
```

Tool Kiểm tra Redirect còn có bản chạy trên máy bằng Node (`npm run ui` ở thư mục gốc), dùng chung giao diện trong `tools/redirect/`, chỉ thay `engine.js` bằng `node/redirect-engine.js`.
