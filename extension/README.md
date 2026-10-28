# Bộ công cụ — Chrome extension

Kho công cụ hỗ trợ test, gói trong một extension. Không cần cài Node hay chạy server.

| Công cụ | Làm gì |
|---|---|
| **Kiểm tra Redirect** | Mở một link nhiều lần, ghi lại từng link nó đi qua (302, JavaScript, meta refresh, mở app) và chỉ ra `sub3`, `sub4`, `Sub_id`, `affiliate_id`, `utm_content` nằm ở link nào. |
| **Kiểm thử API** | Client API kiểu Postman tối giản cho QA: **Collection › Folder › Request**, **Send** ngay (dán cURL / fetch), **Environment** tự tạo (DEV / STAGING / PROD…), test case không cần code (form, Excel, hoặc JSON do AI chuyển từ Excel), **Runner** chạy cả collection theo đúng thứ tự phụ thuộc (Login → lấy TOKEN → request sau), **Preset** để chạy lại một chạm, xuất **Excel / ZIP** evidence PASS / FAIL / ERROR / SKIPPED. Lưu trên máy, không cần tài khoản; che token trong báo cáo, chặn host ngoài danh sách cho phép. |

## Cài đặt

1. Mở Chrome (hoặc Edge, Cốc Cốc), vào `chrome://extensions`.
2. Bật **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm **Load unpacked** (Tải tiện ích đã giải nén) rồi chọn thư mục `extension` này.
4. Ghim icon **Bộ công cụ** lên thanh công cụ cho tiện.

Khi có bản mới, cuối thanh bên hiện thẻ **Bản mới vX.Y.Z** (tự kiểm tra GitHub Releases, tối đa 6 giờ/lần; muốn kiểm tra ngay thì bấm nút **Kiểm tra cập nhật** ⟳ ở hàng icon cuối thanh bên). Bấm vào để xem thay đổi, tải file .zip, giải nén đè vào thư mục cũ rồi bấm **Tải lại extension**.

## Sử dụng

- Bấm icon extension, bộ công cụ mở trong tab mới. Thanh bên trái liệt kê các công cụ (bấm "Công cụ" để thu gọn nhóm, nút ☰ để thu gọn cả thanh bên).
- Tìm công cụ bằng ô tìm kiếm trên đầu trang (phím tắt **Ctrl K** hoặc **/**), bấm Enter để mở công cụ đầu tiên khớp. Trang "Tất cả công cụ" có lọc theo nhóm.
- Mỗi công cụ chạy riêng. Đang chạy dở một cái vẫn chuyển sang cái khác được, quay lại kết quả vẫn còn. Công cụ đang chạy có chấm nhấp nháy ở thanh bên.

### Giao diện

Hai chế độ: **Sáng** và **Tối**. Lần đầu mở, bộ công cụ theo giao diện của máy; bấm nút mặt trăng / mặt trời ở cuối thanh bên trái để đổi. Đổi là áp dụng ngay cho mọi công cụ, lưu trên máy.

Màu dùng cố định theo hệ thiết kế *Dao động ký* (`shared/theme.css`), không có tuỳ chọn đổi màu. Giao diện như một máy đo: vỏ xám, mặt hiển thị than chì cho thanh điều hướng và vùng đọc kết quả, một màu tín hiệu (cam `#FF4F1A`, chữ dùng `#C23B0C` để đạt 4.5:1). Nút chính màu mực; màu tín hiệu chỉ cho mục đang chọn, biến và vạch đo; xanh lá / vàng / đỏ cho trạng thái. Font Be Vietnam Pro, JetBrains Mono cho mã và số liệu, Chakra Petch cho nhãn in hoa.

### Kiểm thử API

Panel bên trái có ba khu vực **Requests · Env · Runner**, ô chọn environment, ô tìm request (Ctrl + K) và cây **Collection › Folder › Request** (chuột phải hoặc nút ⋯ để đổi tên / nhân bản / di chuyển / tắt khi chạy / xoá). Cuối panel là trạng thái lưu, hướng dẫn (**?**) và menu workspace (⋮). Bấm nút thu gọn để panel chỉ còn dải icon.

1. **Request đầu tiên:** *Dán cURL / Fetch* (Postman: `</>` Code → cURL; Chrome: F12 → Network → Copy as cURL / Copy as fetch). Tool đọc chữ, không chạy lệnh, rồi cho **xem lại** các thay đổi đề xuất trước khi áp dụng: tắt header trình duyệt, chuyển token / cookie thành biến bí mật `{{TOKEN}}`, tách `{{baseUrl}}`, cho phép host. Bấm **Send** (Ctrl + Enter) để xem response ngay, chưa cần collection hay environment.
2. **Lưu và tổ chức:** *Lưu vào collection*, tạo folder theo chức năng. Mọi thay đổi tự lưu trên máy.
3. **Environment:** khu vực *Environments* để tạo / nhân bản / đổi tên environment, sửa biến (khoá 🔒 = secret: chỉ giữ trong phiên trình duyệt, che trong báo cáo), Allowed hosts, header chung. Đổi environment ở thanh trên là đổi máy chủ / token cho mọi request.
4. **Lấy token cho request sau:** trong Response bấm tên field (vd `access_token`) → *Lưu thành biến* `TOKEN`. Request khác dùng `{{TOKEN}}`; Runner tự chạy request sinh ra biến trước.
5. **Test case:** tab **Tests** của request. Chọn *Thêm thủ công* (form: HTTP status, kiểm tra field / kiểu / giá trị, thời gian phản hồi tối đa, lưu biến), *Excel → JSON bằng AI* (Copy prompt → gửi AI kèm Excel → dán JSON), *Upload Excel* (map cột, xem trước), hoặc *Import JSON*. Tool báo số case hợp lệ / cần review / lỗi; case thiếu Expected rõ ràng để tắt kèm `NEEDS_REVIEW`.
6. **Runner:** chọn collection + tích folder / request (hoặc chọn **Preset**), environment, chế độ chạy. Tool kiểm tra trước khi chạy (thiếu biến nhập ngay tại chỗ, host chưa được phép, script lỗi…), hỏi xác nhận khi PRODUCTION hoặc có POST / PUT / PATCH / DELETE. Kết quả gom theo request, lọc theo trạng thái / folder / request; bấm một dòng mở **Evidence**. *Chạy lại FAIL / ERROR*, **Export Excel / ZIP**, *Lưu cấu hình thành preset* để lần sau chỉ cần **chọn Preset → Run**.

Cách chấm: **PASS** khi HTTP status thuộc Expected và mọi kiểm tra đạt (4xx/5xx vẫn PASS nếu đó là mong đợi của case negative); **FAIL** khi có response nhưng sai; **ERROR** khi không kiểm thử được (thiếu biến, request phụ thuộc chưa lấy được biến, host bị chặn, timeout, script lỗi…); **SKIPPED** khi case tắt / không được chọn hoặc bấm Stop. Request chưa có test case được chạy với kỳ vọng mặc định HTTP 2xx.

Sao lưu / chuyển máy: menu ⋮ → **Export / Import workspace** (mặc định không kèm token). Dữ liệu của phiên bản trước được tự chuyển sang collection *“Chuyển từ phiên bản trước”* khi mở lần đầu.

Mô hình dữ liệu, thứ tự ưu tiên biến, pipeline chạy, bảo mật và giới hạn: [docs/api-test.md](../docs/api-test.md). Bối cảnh UI/UX: [docs/api-test-ux.md](../docs/api-test-ux.md).

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
   - Chỉ dùng token, không viết mã màu hay cỡ chữ cứng, để chế độ tối và màu tự chọn hoạt động:
     - nền `--bg` (vùng làm việc) · `--bg-subtle` (thanh bên, đầu bảng) · `--bg-raised` (ô nhập, thẻ, menu), trạng thái `--bg-hover` · `--bg-selected`;
     - chữ `--fg` · `--fg-muted` · `--fg-faint`; viền `--line` · `--line-strong`;
     - màu nhấn `--accent` (đồ hoạ) · `--accent-fg` (chữ, nền nút) · `--accent-bg` (nền nhạt) · `--on-accent`; trạng thái `--ok` · `--warn` · `--bad` · `--info` (+ `-bg` chỉ cho khung thông báo);
     - cỡ chữ `--fs-xs … --fs-2xl`, độ cao control `--h-sm` · `--h-md` · `--h-lg`, khoảng cách `--space-*`, bo góc `--rad-sm` · `--rad` · `--rad-lg`.

     Quy tắc chi tiết ở đầu `shared/theme.css`. Tên cũ (`--primary-strong`, `--surface`, `--text-secondary`…) vẫn chạy nhưng không dùng cho code mới.
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
  hub.html/.css/.js    khung bộ công cụ (đầu trang + tìm kiếm, thanh bên, danh mục công cụ, cài đặt giao diện)
  shared/              giao diện dùng chung (theme.css, theme.js, embed.js)
  tools/
    registry.js        danh sách công cụ
    _template/         khung để tạo tool mới
    redirect/          Kiểm tra Redirect (index.html, style.css, app.js, engine.js)
    api-test/          Kiểm thử API: workspace.js / engine.js / runner.js / schema.js (domain), store.js / transport.js / report.js / script-host.js (services), app*.js + ui.js (giao diện)
  icons/
```

Bản web chạy bằng Node (`npm run ui` ở thư mục gốc) phục vụ nguyên thư mục này nên giao diện giống hệt extension; chỉ `tools/redirect/engine.js` được thay bằng `node/redirect-engine.js`, còn Kiểm thử API gửi request qua `/api/proxy` của máy chủ. Tool nào chỉ chạy được trong extension thì ghi `platforms: ['extension']` trong `tools/registry.js` để bản web tự ẩn.
