## ADDED Requirements

### Requirement: Direct manager is notified when bypassed as approver
For proposal groups configured with `notifyManager: true`, when a submitter uses `managerOverrides` to select an approver other than their own direct manager (`departmentId` → `department.leaderId`), the system SHALL notify that direct manager, provided the manager did not opt out via `manager_bypassed` in their notification preferences.

#### Scenario: Submitter overrides their manager as approver
- **WHEN** a request is submitted to a group with `notifyManager: true`, the submitter's department leader is `manager-A`, and the submitter selects `user-B` (not `manager-A`) as approver via `managerOverrides`
- **THEN** `manager-A` sees a "bị qua mặt duyệt" item in their notification bell for that request

#### Scenario: Submitter keeps their direct manager as approver
- **WHEN** a request is submitted to a group with `notifyManager: true` and the resolved approver equals the submitter's direct manager (no override, or override resolves to the same person)
- **THEN** no `manager_bypassed` notification is created for anyone

#### Scenario: Group has notifyManager disabled
- **WHEN** a request is submitted to a group with `notifyManager: false` and an override is used
- **THEN** no `manager_bypassed` notification is created, regardless of who was chosen as approver

#### Scenario: Submitter has no resolvable direct manager
- **WHEN** the submitter's `departmentId` does not resolve to any `leaderId` (e.g. no department set, or department has no leader)
- **THEN** no `manager_bypassed` notification is created (nothing to notify)

#### Scenario: Manager opted out of this category
- **WHEN** `manager-A` has disabled `manager_bypassed` in their notification preferences
- **THEN** `manager-A`'s bell does not show the bypass item, even though the underlying condition is true
