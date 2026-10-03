## 1. Luật chung

- [x] 1.1 Tạo hàm thuần `resolveDirectManagerIdWith` + `prioritizeDirectManagers` trong `lib/direct-manager.ts`
- [x] 1.2 Test vitest đủ ca hợp đồng (`lib/direct-manager.test.ts`)

## 2. Máy chủ

- [x] 2.1 `resolveSubmitterManager`/`resolveDirectManagerId` dùng luật mới, null → MissingApproverError
- [x] 2.2 Picker `/api/directory/managers` đưa `directManagerIds` lên đầu, cache khoá theo uid
- [x] 2.3 Scope `manager-bypassed` dùng luật mới (qua `resolveDirectManagerId`)

## 3. Form gửi đề xuất

- [x] 3.1 Điền sẵn gợi ý mặc định + nhãn "Mặc định", vẫn đổi được

## 4. Kiểm

- [x] 4.1 vitest, `npx tsc --noEmit`, `npm run lint`, `npm run build`
