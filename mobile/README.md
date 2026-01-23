# Gatekeeper Mobile

React Native mobile app for the Gatekeeper authentication system, built with Expo SDK 53.

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm start

# Run on Android
npm run android

# Run on iOS
npm run ios
```

## Testing

### Unit & Integration Tests

The app has comprehensive test coverage using Jest and React Native Testing Library.

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests for CI (with JUnit output)
npm run test:ci
```

**Test Structure:**
```
__tests__/
├── lib/                    # Unit tests for core libraries
│   ├── passkey.test.ts     # Passkey registration/authentication
│   ├── linking.test.ts     # Deep linking utilities
│   └── security.test.ts    # Biometric/security helpers
└── screens/                # Integration tests for screens
    ├── login.test.tsx      # Login screen
    ├── register.test.tsx   # Registration screen
    ├── auth.test.tsx       # Auth callback handler
    ├── profile.test.tsx    # Profile screen
    └── dashboard.test.tsx  # Dashboard screen
```

### E2E Tests (Maestro)

End-to-end tests run on real devices/emulators using Maestro.

```bash
# Run all E2E flows
npm run e2e

# Open Maestro Studio (visual test builder)
npm run e2e:studio

# Record a new test flow
npm run e2e:record
```

**E2E Flows:**
- `01-login.yaml` - Login form validation and authentication
- `02-register.yaml` - Account registration flow
- `03-ui-elements.yaml` - UI smoke tests
- `04-signout.yaml` - Sign out flow
- `05-profile.yaml` - Profile editing
- `06-security.yaml` - Security settings and passkey management

## Building

### Development Builds

```bash
# Android development build
npm run build:android

# iOS development build
npm run build:ios
```

### Preview Builds

```bash
# Android preview build
npm run build:android:preview

# iOS preview build
npm run build:ios:preview
```

## CI/CD

The project uses GitHub Actions for continuous integration:

### Workflows

**test.yml** - Runs on every push and PR:
- TypeScript type checking
- Unit and integration tests
- Coverage report generation

**build.yml** - Runs on merge to main:
- Runs tests first
- Triggers EAS builds for Android and iOS
- Supports manual triggers with platform/profile selection

### Setup

1. Create an Expo access token at [expo.dev](https://expo.dev) → Account Settings → Access Tokens
2. Add `EXPO_TOKEN` secret to your GitHub repository settings

## Project Structure

```
mobile/
├── app/                    # Expo Router screens
│   ├── (tabs)/             # Tab navigator screens
│   │   ├── index.tsx       # Dashboard
│   │   ├── profile.tsx     # Profile settings
│   │   └── security.tsx    # Security settings
│   ├── login.tsx           # Login screen
│   ├── register.tsx        # Registration screen
│   └── auth.tsx            # OAuth callback handler
├── src/
│   ├── components/         # Reusable components
│   ├── contexts/           # React contexts (Auth)
│   ├── lib/                # Core utilities
│   │   ├── passkey.ts      # Passkey operations
│   │   ├── linking.ts      # Deep link handling
│   │   ├── security.ts     # Biometric helpers
│   │   └── supabase.ts     # Supabase client
│   └── mocks/              # Test mocks
├── __tests__/              # Test files
├── .maestro/               # Maestro E2E tests
│   ├── config.yaml
│   └── flows/
└── .github/workflows/      # CI/CD configuration
```

## Environment Variables

Create a `.env` file or configure in `app.config.js`:

```
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

## Technologies

- **Expo SDK 53** - React Native framework
- **Expo Router** - File-based routing
- **Supabase** - Backend and authentication
- **react-native-passkey** - WebAuthn/Passkey support
- **Jest + React Native Testing Library** - Testing
- **Maestro** - E2E testing
- **EAS Build** - Cloud builds
- **GitHub Actions** - CI/CD
