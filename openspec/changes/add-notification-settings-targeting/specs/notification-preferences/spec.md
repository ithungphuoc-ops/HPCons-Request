## ADDED Requirements

### Requirement: User can configure which notification categories to receive
The system SHALL allow each user to independently enable/disable 5 notification categories via a personal settings page: `approver_pending` (có đề xuất cần mình duyệt), `own_decided` (đề xuất của mình đã có kết quả duyệt), `mentioned` (được @nhắc tên trong bình luận), `following` (đề xuất mình đang theo dõi), `manager_bypassed` (là quản lý trực tiếp nhưng bị chọn người khác duyệt thay). Settings are stored per-user and persist across sessions.

#### Scenario: User disables one category
- **WHEN** user opens Cài đặt thông báo and turns off "được nhắc tên (@mention)"
- **THEN** the setting is saved for that user, and subsequent bell loads no longer include mention-based items for that user

#### Scenario: User has never configured settings
- **WHEN** a user who has never opened the settings page loads the notification bell
- **THEN** all 5 categories are treated as enabled (default-on), matching current behavior before this change

#### Scenario: Settings only affect the bell, not the request list pages
- **WHEN** a user disables "cần mình duyệt" in notification settings
- **THEN** the request list page (`/request/requests?scope=inbox`) still shows all pending-approval requests for that user — only the bell's item count/list is filtered

### Requirement: Notification bell reads and applies the current user's settings
The system SHALL fetch the current user's `notificationSettings` alongside the existing 4 (soon 5) notification sources, and exclude any source whose category is disabled before rendering the bell list and unread count.

#### Scenario: Disabled category excluded from unread count
- **WHEN** user has "cần mình duyệt" disabled and has 3 pending approvals
- **THEN** the bell's numeric badge does not count those 3 pending approvals
