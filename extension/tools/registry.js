// Danh sách công cụ trong bộ. Thêm tool mới: tạo thư mục tools/<id>/ (copy từ tools/_template)
// rồi thêm 1 mục vào đây. Icon lấy tên từ https://fonts.google.com/icons (bộ Material Symbols).
//   category  — nhóm hiển thị ở bộ lọc trang chủ
//   platforms — 'extension' (chạy trong Chrome extension) và/hoặc 'web' (bản npm run ui).
//               Tool dùng API chrome.* mà không có engine cho web thì chỉ ghi 'extension'.
window.TOOLS = [
  {
    id: 'redirect',
    name: 'Kiểm tra Redirect',
    icon: 'alt_route',
    category: 'Link & Affiliate',
    desc: 'Mở một link nhiều lần, ghi lại từng link nó đi qua và chỉ ra sub3, sub4, Sub_id, affiliate_id, utm_content nằm ở đâu.',
    tags: ['Link', 'Affiliate'],
    platforms: ['extension', 'web'],
    path: 'tools/redirect/index.html',
  },
  {
    id: 'api-test',
    name: 'Kiểm thử API',
    icon: 'api',
    category: 'API',
    desc: 'Collection, Environment và Send như Postman; test case không cần code (form, Excel, AI); chạy cả collection theo thứ tự phụ thuộc, lưu Preset, xuất Excel / ZIP evidence.',
    tags: ['API', 'cURL', 'Postman', 'Excel', 'Tự động'],
    platforms: ['extension', 'web'],
    path: 'tools/api-test/index.html',
  },
];
