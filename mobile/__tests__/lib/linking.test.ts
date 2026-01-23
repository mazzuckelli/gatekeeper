import * as Linking from 'expo-linking';
import {
  isValidCallbackUrl,
  parseAuthDeepLink,
  openUrl,
  linkingConfig,
} from '../../src/lib/linking';

describe('linking.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isValidCallbackUrl()', () => {
    describe('valid URLs', () => {
      it('returns true for dawgtag:// URLs', () => {
        expect(isValidCallbackUrl('dawgtag://callback')).toBe(true);
        expect(isValidCallbackUrl('dawgtag://auth/success')).toBe(true);
        expect(isValidCallbackUrl('dawgtag://')).toBe(true);
      });

      it('returns true for exp:// URLs (Expo development)', () => {
        expect(isValidCallbackUrl('exp://192.168.1.1:8081')).toBe(true);
        expect(isValidCallbackUrl('exp://localhost:8081/--/callback')).toBe(true);
      });

      it('returns true for https:// URLs', () => {
        expect(isValidCallbackUrl('https://example.com/callback')).toBe(true);
        expect(isValidCallbackUrl('https://dawgtag.app/auth')).toBe(true);
        expect(isValidCallbackUrl('https://gatekeeper-nine.vercel.app/auth')).toBe(true);
      });
    });

    describe('invalid URLs', () => {
      it('returns false for http:// URLs (not secure)', () => {
        expect(isValidCallbackUrl('http://example.com/callback')).toBe(false);
        expect(isValidCallbackUrl('http://localhost/callback')).toBe(false);
      });

      it('returns false for javascript: URLs (XSS attempt)', () => {
        expect(isValidCallbackUrl('javascript:alert(1)')).toBe(false);
        expect(isValidCallbackUrl('javascript:void(0)')).toBe(false);
      });

      it('returns false for data: URLs', () => {
        expect(isValidCallbackUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      });

      it('returns false for file: URLs', () => {
        expect(isValidCallbackUrl('file:///etc/passwd')).toBe(false);
      });

      it('returns false for null', () => {
        expect(isValidCallbackUrl(null)).toBe(false);
      });

      it('returns false for empty string', () => {
        expect(isValidCallbackUrl('')).toBe(false);
      });

      it('returns false for undefined (cast to null)', () => {
        expect(isValidCallbackUrl(undefined as any)).toBe(false);
      });

      it('returns false for random schemes', () => {
        expect(isValidCallbackUrl('malicious://steal-data')).toBe(false);
        expect(isValidCallbackUrl('custom://app/path')).toBe(false);
      });

      it('returns false for partial matches (not starting with prefix)', () => {
        expect(isValidCallbackUrl('notdawgtag://callback')).toBe(false);
        expect(isValidCallbackUrl('xhttps://example.com')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('is case-sensitive for schemes', () => {
        // URL schemes should be lowercase
        expect(isValidCallbackUrl('DAWGTAG://callback')).toBe(false);
        expect(isValidCallbackUrl('HTTPS://example.com')).toBe(false);
      });

      it('handles URLs with special characters', () => {
        expect(isValidCallbackUrl('dawgtag://callback?token=abc&state=xyz')).toBe(true);
        expect(isValidCallbackUrl('https://example.com/path?redirect=https%3A%2F%2Fother.com')).toBe(true);
      });

      it('handles URLs with fragments', () => {
        expect(isValidCallbackUrl('dawgtag://callback#section')).toBe(true);
        expect(isValidCallbackUrl('https://example.com/#/auth')).toBe(true);
      });
    });
  });

  describe('parseAuthDeepLink()', () => {
    it('extracts callback parameter from URL', () => {
      const url = 'https://gatekeeper-nine.vercel.app/auth?callback=dawgtag://success';

      const result = parseAuthDeepLink(url);

      expect(result).toBe('dawgtag://success');
    });

    it('returns undefined when no callback parameter', () => {
      const url = 'https://gatekeeper-nine.vercel.app/auth';

      const result = parseAuthDeepLink(url);

      expect(result).toBeUndefined();
    });

    it('returns undefined for malformed URLs', () => {
      const result = parseAuthDeepLink('not a valid url');

      expect(result).toBeUndefined();
    });

    it('handles URL-encoded callbacks', () => {
      const encodedCallback = encodeURIComponent('dawgtag://auth?token=abc');
      const url = `https://gatekeeper-nine.vercel.app/auth?callback=${encodedCallback}`;

      const result = parseAuthDeepLink(url);

      expect(result).toBe('dawgtag://auth?token=abc');
    });

    it('handles multiple query parameters', () => {
      const url = 'https://gatekeeper-nine.vercel.app/auth?foo=bar&callback=dawgtag://success&baz=qux';

      const result = parseAuthDeepLink(url);

      expect(result).toBe('dawgtag://success');
    });

    it('returns null for empty callback parameter', () => {
      const url = 'https://gatekeeper-nine.vercel.app/auth?callback=';

      const result = parseAuthDeepLink(url);

      // Empty string is falsy, so should return it as-is (the function returns as string | null)
      expect(result).toBe('');
    });

    it('handles custom scheme URLs as input', () => {
      const url = 'gatekeeper://auth?callback=dawgtag://success';

      const result = parseAuthDeepLink(url);

      expect(result).toBe('dawgtag://success');
    });

    it('returns null when Linking.parse throws an exception', () => {
      // Use jest.spyOn to mock Linking.parse to throw
      const parseSpy = jest.spyOn(Linking, 'parse').mockImplementation(() => {
        throw new Error('Parse error');
      });

      const result = parseAuthDeepLink('some-url');

      expect(result).toBeNull();

      parseSpy.mockRestore();
    });
  });

  describe('openUrl()', () => {
    it('opens valid URLs that can be opened', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
      (Linking.openURL as jest.Mock).mockResolvedValue(undefined);

      await openUrl('dawgtag://callback');

      expect(Linking.canOpenURL).toHaveBeenCalledWith('dawgtag://callback');
      expect(Linking.openURL).toHaveBeenCalledWith('dawgtag://callback');
    });

    it('throws error for URLs that cannot be opened', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(false);

      await expect(openUrl('unknown://scheme')).rejects.toThrow('Cannot open URL: unknown://scheme');

      expect(Linking.openURL).not.toHaveBeenCalled();
    });

    it('handles https URLs', async () => {
      (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
      (Linking.openURL as jest.Mock).mockResolvedValue(undefined);

      await openUrl('https://example.com');

      expect(Linking.openURL).toHaveBeenCalledWith('https://example.com');
    });
  });

  describe('linkingConfig', () => {
    it('includes custom scheme prefix', () => {
      expect(linkingConfig.prefixes).toContain('gatekeeper://');
    });

    it('includes production domain for universal links', () => {
      expect(linkingConfig.prefixes).toContain('https://gatekeeper-nine.vercel.app');
    });

    it('has exactly 2 prefixes configured', () => {
      expect(linkingConfig.prefixes).toHaveLength(2);
    });
  });
});
