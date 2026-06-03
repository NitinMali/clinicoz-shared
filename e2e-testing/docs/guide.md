# Test Instruction Writing Guide

This guide explains how to write test instructions for the Clinicoz E2E Testing Engine.

---

## Golden Rules

1. **One action per step** — Don't combine multiple actions in one instruction
2. **Start with the action verb** — Click, Type, Clear, Wait, Select
3. **Use `data-testid` selectors** — Fastest, cheapest, most reliable (no AI needed)
4. **Be specific** — The more detail you give, the better the result

---

## Action Types

### Click

Clicks an element on the page.

```
Click [data-testid="save-button"]
Click button[type="submit"]
Click #login-btn
Click .btn-primary
Click the submit button
```

### Type / Fill

Types text into an input field. Always put the text in quotes.

```
Type "kaveri@test.com" in [data-testid="email-input"]
Type "Pass@1234" in input#password
Type "Nitin Mali" in input[placeholder="Search by patient name"]
Type the current date and time into [data-testid="gov-id-input"]
```

### Clear

Clears an input field.

```
Clear [data-testid="gov-id-input"]
Clear input#govId
```

### Select (PrimeReact Dropdown)

Selects an option from a PrimeReact `p-dropdown`. Handles the open + click automatically.

```
Select "Male" in #gender
Select "Active" in [data-testid="status-dropdown"]
Select "Dr. Smith" in .doctor-dropdown
```

---

## Wait Instructions (Handled directly — no AI call)

### Wait for page navigation

```
Wait for page to redirect to /visits
Wait for page to redirect to /patients/
Wait for page to navigate to /dashboard
```

### Wait for page to load

```
Wait for page to load
```

### Wait for PrimeReact sidebar

```
Wait for sidebar to appear
Wait for sidebar to open
Wait for panel to appear
```

### Wait for PrimeReact dialog/modal

```
Wait for dialog to appear
Wait for modal to open
```

### Wait for toast/notification

```
Wait for toast message to appear
Wait for success message to appear
Wait for notification to appear
```

### Wait a fixed time

```
Wait 2 seconds
Wait 5 seconds
```

---

## Utility Values (Dynamic Data Generation)

Use these keywords in Type instructions to generate random/dynamic values:

### Random Name (always prefixed with "Test")

```
Type random name in input[data-testid="patient-firstname-input"]
```
→ Generates: "Test David Kumar", "Test Priya Singh", etc.

With custom prefix:
```
Type random name prefix with "QA Patient" in input[data-testid="patient-firstname-input"]
```
→ Generates: "QA Patient Michael Brown"

### Random Mobile (leading zeros for easy identification)

```
Type random mobile in input[data-testid="patient-primarymobile-input"]
```
→ Generates: "0000012345", "0000098761"

With custom length:
```
Type random mobile(6) in input[data-testid="phone-input"]
```
→ Generates: "012345"

### Random Email

```
Type random email in input[data-testid="patient-email-input"]
```
→ Generates: "test.a8k3m2@test.com"

### Current Date and Time

```
Type current date and time in input[data-testid="gov-id-input"]
```
→ Generates: "5/24/2026, 10:30:00 PM"

### Current Date Only

```
Type current date in input[data-testid="date-input"]
```
→ Generates: "5/24/2026"

### Random Number

```
Type random number(1, 100) in input[data-testid="age-input"]
```
→ Generates: "42"

### Cleanup Tip: Deleting Test Data

Since `random name` generates a different value each run, you can't reference it later in the same test to delete it. Two workarounds:

**Option A:** Use a fixed name you can search for:
```
3. Type "Test AutoDelete Patient" in input[data-testid="patient-firstname-input"]
...after creation...
9. Type "Test AutoDelete Patient" in input[data-testid="search-input"]
10. Click [data-testid="delete-patient-btn"]
```

**Option B (coming soon):** Variable support — store generated values for reuse:
```
3. Type random name as $patientName in input[data-testid="patient-firstname-input"]
...after creation...
9. Type $patientName in input[data-testid="search-input"]
10. Click [data-testid="delete-patient-btn"]
```

---

## Verify Instructions (No AI needed)

```
Verify the page URL contains /visits
Verify the page has loaded
```

---

## Selector Formats (Direct — No AI Call)

Using direct selectors bypasses the AI entirely — faster, free, and 100% reliable.

### By data-testid (RECOMMENDED)

```
Click [data-testid="edit-other-details"]
Type "hello" in [data-testid="email-input"]
Clear [data-testid="gov-id-input"]
Select "Male" in [data-testid="gender-dropdown"]
```

### By ID

```
Click #submit-btn
Type "hello" in #email
```

### By Class

```
Click .btn-primary
Click .pi-pencil
```

### By Attribute

```
Click input[placeholder="Search"]
Click button[aria-label="Log In"]
```

### By Tag + Attribute

```
Click button[type="submit"]
Type "hello" in input#email
```

### By XPath (for complex selections like "3rd element")

```
Click on (//h6[contains(text(),'Other Details')]/following-sibling::i)[1]
Click on (//i[contains(@class,'pi-pencil')])[3]
```

---

## PrimeReact Component Selectors

Your app uses PrimeReact. Here are the common patterns:

### Inputs (p-inputtext)

```
Type "text" in [data-testid="my-input"]
Type "text" in input.p-inputtext
```

### Buttons (p-button)

```
Click [data-testid="save-btn"]
Click button.p-button
```

### Dropdown (p-dropdown)

```
Select "Male" in [data-testid="gender-dropdown"]
Select "Active" in #status
```

### Autocomplete (p-autocomplete)

```
Type "Nitin" in [data-testid="patient-search"]
Wait for page to load
Click li.p-autocomplete-item
```

### Sidebar (p-sidebar)

```
Wait for sidebar to appear
Click [data-testid="save-sidebar"]
```

### Dialog (p-dialog)

```
Wait for dialog to appear
Click [data-testid="confirm-btn"]
```

### Toast (p-toast)

```
Wait for toast message to appear
```

### DataTable (p-datatable)

```
Click [data-testid="row-edit-btn"]
Click tr.p-datatable-row:nth-child(2)
```

### TabView (p-tabview)

```
Click [data-testid="tab-profile"]
Click li.p-tabview-nav-link
```

---

## data-testid Naming Convention

Ask developers to add `data-testid` to all interactive elements using this pattern:

```
{page}-{section}-{action}-{element}
```

Examples:

| Element | data-testid |
|---------|-------------|
| Login submit button | `login-submit-btn` |
| Patient search input | `header-patient-search` |
| Edit "Other Details" icon | `profile-other-details-edit` |
| Gender dropdown | `profile-basic-gender` |
| Sidebar save button | `sidebar-save-btn` |
| Government ID input | `profile-other-details-gov-id` |

### Developer Implementation

```jsx
// Button
<Button data-testid="login-submit-btn" label="Login" type="submit" />

// Input
<InputText data-testid="header-patient-search" placeholder="Search..." />

// Dropdown
<Dropdown data-testid="profile-basic-gender" options={genders} />

// Icon button
<i className="pi pi-pencil" data-testid="profile-other-details-edit" />

// Sidebar save
<Button data-testid="sidebar-save-btn" label="Save" />
```

---

## Auth Settings (Skip Login Steps)

Configure auth in the dashboard UI (Auth Settings section) to auto-login before each test:

1. Enter Login URL, Email, Password
2. Click "Save Auth"
3. Set your test's Target URL directly to the page you want to test

**With auth configured:**
```
Target URL: https://admin.clinicoz.com/cms/patients/77e96.../profile

1. Click [data-testid="profile-other-details-edit"]
2. Wait for sidebar to appear
3. Clear [data-testid="profile-other-details-gov-id"]
4. Type the current date and time into [data-testid="profile-other-details-gov-id"]
5. Click [data-testid="sidebar-save-btn"]
6. Wait for toast message to appear
```

No login steps needed!

---

## Complete Example (Without Auth Settings)

```
Target URL: https://admin.clinicoz.com/cms/login

1. Type "kaveri@test.com" in input#email
2. Type "Pass@1234" in input#password
3. Click button[type="submit"]
4. Wait for page to redirect to /visits
5. Click [data-testid="header-patient-search"]
6. Type "Nitin Mali" in [data-testid="header-patient-search"]
7. Wait for page to load
8. Click li.p-autocomplete-item
9. Wait for page to redirect to /patients/
10. Click [data-testid="profile-other-details-edit"]
11. Wait for sidebar to appear
12. Clear [data-testid="profile-other-details-gov-id"]
13. Type the current date and time into [data-testid="profile-other-details-gov-id"]
14. Click [data-testid="sidebar-save-btn"]
15. Wait for toast message to appear
```

---

## Running with Docker (For QA Testers)

### First-time setup
1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. Get the `e2e-testing-runner` folder from your team lead
3. Open the folder — it contains: `docker-compose.yml`, `.env`, `run.bat`, `stop.bat`

### Daily usage
1. Double-click `run.bat` — pulls latest version, starts the app, opens browser
2. Use the dashboard at `http://localhost:3005`
3. Double-click `stop.bat` when done

### Target URLs

| Testing against | Target URL format |
|----------------|-------------------|
| Production/staging | `https://admin.clinicoz.com/cms/login` |
| Local dev app (when running in Docker) | `http://host.docker.internal:4200` |
| Local dev app (when running without Docker) | `http://localhost:4200` |

**Important:** When running the e2e engine inside Docker and testing a local app, use `host.docker.internal` instead of `localhost`. This tells Docker to reach your host machine's network.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "AI could not map instruction" | Use a direct selector (`data-testid`, `#id`, `.class`) |
| "Timeout waiting for selector" | Element doesn't exist — verify selector in browser DevTools |
| "Element is not an input" | You're trying to type into a non-input (like a button). Check instruction starts with "Click" |
| Wrong action (fill instead of click) | Ensure instruction starts with "Click" not "Type" |
| Navigation timeout | Check URL pattern — use partial path like `/visits` not full URL |
| Stale cached selector | Click "Clear Cache" button in the header |
| Double login (auth + manual steps) | Either use Auth Settings OR manual login steps, not both |
| PrimeReact dropdown not selecting | Use `Select "Option" in #id` format |
| Autocomplete results not appearing | Add `Wait for page to load` between typing and clicking result |
| Can't reach localhost app from Docker | Use `http://host.docker.internal:PORT` as target URL |
| Docker port conflict | Another app uses port 3005 — change PORT in `.env` |
