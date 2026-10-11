# Nhật ký thay đổi

Ghi theo [Keep a Changelog](https://keepachangelog.com/vi/1.1.0/), đánh số theo [Semantic Versioning](https://semver.org/lang/vi/).

## [Chưa phát hành]

### Thêm
- Tự kiểm tra bản mới trên GitHub Releases: đầu trang hiện nút **Bản mới**, bảng **Cập nhật** có ghi chú thay đổi, nút tải .zip và tải lại extension; nút **Kiểm tra cập nhật** ở cuối thanh bên.
- Link **Mã nguồn trên GitHub** ở thanh bên; link repo trong `manifest.json` (homepage_url) và `package.json`.

### Thay đổi
- Icon và logo mới cho extension, đầu trang bộ công cụ và README (có bản logo cho nền tối).

## [1.3.0] - 2026-10-11

### Thêm
- Đầu trang mới: tìm công cụ (Ctrl K hoặc /), nút chuyển nhanh Theo hệ thống / Sáng / Tối, nút mở Giao diện.
- Trang **Tất cả công cụ** có đếm số và lọc theo nhóm; thanh bên có nhóm "Công cụ" thu gọn được.
- Trường `category` và `platforms` trong `tools/registry.js`.
- Thang chữ, khoảng cách (bội số 4px) và bo góc dùng chung trong `shared/theme.css`.
- Quy tắc commit theo Conventional Commits, kiểm tra tự động bằng commitlint + husky và trên CI.

### Thay đổi
- Font Inter cho toàn bộ giao diện, mono của hệ điều hành cho link và mã.
- Bản web (`npm run ui`) dùng nguyên khung bộ công cụ, giao diện giống hệt extension.
- Tên gói `qa-toolkit`, tác giả [vietvd13](https://github.com/vietvd13).

### Sửa
- Đổi sáng/tối không còn thoáng thấy nền cũ với chữ mới trên thẻ công cụ.

## [1.2.0] - 2026-10-11

### Thêm
- Hệ màu *Feminine Work OS* (màu gốc → vai trò → thành phần) cho mọi công cụ.
- Chế độ màu Theo hệ thống / Sáng / Tối, tự đổi khi hệ điều hành đổi.
- Bảng **Giao diện**: chọn màu chủ đạo, màu phụ (có sẵn hoặc tự chọn), xem trước, kiểm tra độ dễ đọc.
- Tự chỉnh màu quá nhạt để chữ đạt tương phản 4.5:1.

### Thay đổi
- Chữ và nút chính trong giao diện sáng dùng rose-600 `#AD4168` (rose-500 chỉ đạt 4.26:1 với chữ trắng).
- Nút "Dừng" dùng kiểu nút nguy hiểm (nền đỏ).

## [1.1.0] - 2026-10-11

### Thêm
- Khung **Bộ công cụ**: thanh bên, trang chọn công cụ, công cụ chạy song song không mất kết quả.
- Giao diện dùng chung `shared/theme.css` và khung mẫu `tools/_template` để tạo công cụ mới.
- Lệnh `npm run ext:zip` đóng gói extension.

### Thay đổi
- Bản web (`npm run ui`) dùng chung giao diện với extension.

## [1.0.0] - 2026-10-11

### Thêm
- Chrome extension **Kiểm tra Redirect**: ghi lại mọi bước chuyển hướng (302, JavaScript, meta refresh, mở app) bằng `webRequest`/`webNavigation`.
- Tìm `sub3`, `sub4`, `Sub_id`, `affiliate_id`, `utm_content` ở từng link, kể cả link lồng đã mã hoá.
- Tổng quan, tỉ lệ từng giá trị, nhóm kết quả, nhận xét tự động, xem bằng chứng, xuất CSV.
- Bản dòng lệnh và bản web chạy bằng Playwright; script dán vào Console.

[Chưa phát hành]: ../../compare/v1.3.0...HEAD
[1.3.0]: ../../releases/tag/v1.3.0
[1.2.0]: ../../releases/tag/v1.2.0
[1.1.0]: ../../releases/tag/v1.1.0
[1.0.0]: ../../releases/tag/v1.0.0
