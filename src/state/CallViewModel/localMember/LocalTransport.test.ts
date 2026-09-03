/*
Copyright 2025 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE in the repository root for full details.
*/

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockedObject,
  vi,
} from "vitest";
import { type LivekitTransportConfig } from "matrix-js-sdk/lib/matrixrtc";
import fetchMock from "fetch-mock";

import {
  mockConfig,
  flushPromises,
  ownMemberMock,
  testScope,
} from "../../../utils/test";
import {
  createLocalTransport$,
  JwtEndpointVersion,
  type LocalTransportWithSFUConfig,
} from "./LocalTransport";
import { constant } from "../../Behavior";
import {
  MatrixRTCTransportMissingError,
  FailToGetOpenIdToken,
} from "../../../utils/errors";
import * as openIDSFU from "../../../livekit/openIDSFU";
import { customLivekitUrl } from "../../../settings/settings";
import { testJWTToken } from "../../../utils/test-fixtures";
import { state } from "../../Behavior";

describe("LocalTransport", () => {
  const openIdResponse: openIDSFU.SFUConfig = {
    url: "https://lk.example.org",
    jwt: testJWTToken,
    livekitAlias: "Akph4alDMhen",
    livekitIdentity: "@lk_user:ABCDEF",
  };

  beforeEach(() => vi.clearAllMocks());

  it("fails if config is missing", async () => {
    const { advertised$, active$, error$ } = createLocalTransport$({
      scope: testScope(),
      roomId: "!room:example.org",
      client: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        _unstable_getRTCTransports: async () => Promise.resolve([]),
        getDomain: () => "example.org",
        baseUrl: "example.org",
        // These won't be called in this error path but satisfy the type
        getOpenIdToken: vi.fn(),
        getDeviceId: vi.fn(),
      },
      ownMembershipIdentity: ownMemberMock,
      forceJwtEndpoint: JwtEndpointVersion.Legacy,
      delayId$: constant("delay_id_mock"),
    });
    await flushPromises();

    expect(error$.value).toEqual(
      new MatrixRTCTransportMissingError("example.org"),
    );
    expect(advertised$.value).toBe(null);
    expect(active$.value).toBe(null);
  });

  it("fails with FailToGetOpenIdToken when OpenID fetch fails", async () => {
    // Provide a valid config so makeTransportInternal resolves a transport
    const scope = testScope();
    mockConfig({
      livekit: { livekit_service_url: "https://lk.example.org" },
    });
    const resolver = Promise.withResolvers<void>();
    vi.spyOn(openIDSFU, "getSFUConfigWithOpenID").mockImplementation(
      async () => {
        await resolver.promise;
        throw new FailToGetOpenIdToken(new Error("no openid"));
      },
    );
    const { advertised$, active$, error$ } = createLocalTransport$({
      scope,
      roomId: "!example_room_id",
      client: {
        baseUrl: "https://example.org",
        getDomain: () => "example.org",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        _unstable_getRTCTransports: async () => Promise.resolve([]),
        getOpenIdToken: vi.fn(),
        getDeviceId: vi.fn(),
      },
      ownMembershipIdentity: ownMemberMock,
      forceJwtEndpoint: JwtEndpointVersion.Legacy,
      delayId$: constant("delay_id_mock"),
    });
    expect(error$.value).toBe(null);
    resolver.resolve();
    await flushPromises();

    expect(error$.value).toEqual(
      new FailToGetOpenIdToken(new Error("no openid")),
    );
    expect(advertised$.value).toBe(null);
    expect(active$.value).toBe(null);
  });

  it("emits preferred transport after OpenID resolves", async () => {
    // Use config so transport discovery succeeds, but delay OpenID JWT fetch
    mockConfig({
      livekit: { livekit_service_url: "https://lk.example.org" },
    });

    const openIdResolver = Promise.withResolvers<openIDSFU.SFUConfig>();

    vi.spyOn(openIDSFU, "getSFUConfigWithOpenID").mockReturnValue(
      openIdResolver.promise,
    );

    const { advertised$, active$ } = createLocalTransport$({
      scope: testScope(),
      roomId: "!room:example.org",
      client: {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        _unstable_getRTCTransports: async () => Promise.resolve([]),
        getDomain: () => "example.org",
        getOpenIdToken: vi.fn(),
        getDeviceId: vi.fn(),
        baseUrl: "https://example.org",
      },
      ownMembershipIdentity: ownMemberMock,
      forceJwtEndpoint: JwtEndpointVersion.Legacy,
      delayId$: constant("delay_id_mock"),
    });

    openIdResolver.resolve?.({
      url: "https://lk.example.org",
      jwt: "jwt",
      livekitAlias: "Akph4alDMhen",
      livekitIdentity: ownMemberMock.userId + ":" + ownMemberMock.deviceId,
    });
    expect(advertised$.value).toBe(null);
    expect(active$.value).toBe(null);
    await flushPromises();
    // final
    const expectedTransport = {
      livekit_service_url: "https://lk.example.org",
      type: "livekit",
    };
    expect(advertised$.value).toStrictEqual(expectedTransport);
    expect(active$.value).toStrictEqual({
      transport: expectedTransport,
      sfuConfig: {
        jwt: "jwt",
        livekitAlias: "Akph4alDMhen",
        livekitIdentity: "@alice:example.org:DEVICE",
        url: "https://lk.example.org",
      },
    });
  });

  type LocalTransportProps = Parameters<typeof createLocalTransport$>[0];

  describe("transport configuration mechanisms", () => {
    let localTransportOpts: LocalTransportProps & {
      client: MockedObject<LocalTransportProps["client"]>;
    };
    let openIdResolver: PromiseWithResolvers<openIDSFU.SFUConfig>;
    beforeEach(() => {
      mockConfig({});
      customLivekitUrl.setValue(customLivekitUrl.defaultValue);
      localTransportOpts = {
        ownMembershipIdentity: ownMemberMock,
        scope: testScope(),
        roomId: "!example_room_id",
        forceJwtEndpoint: JwtEndpointVersion.Legacy,
        delayId$: constant(null),
        client: {
          baseUrl: "https://example.org",
          getDomain: vi.fn().mockReturnValue("example.org"),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          _unstable_getRTCTransports: vi.fn().mockResolvedValue([]),
          getOpenIdToken: vi.fn(),
          getDeviceId: vi.fn(),
        },
      };
      openIdResolver = Promise.withResolvers<openIDSFU.SFUConfig>();
      vi.spyOn(openIDSFU, "getSFUConfigWithOpenID").mockReturnValue(
        openIdResolver.promise,
      );
    });

    afterEach(() => {
      fetchMock.reset();
    });

    it("supports getting transport via application config", async () => {
      mockConfig({
        livekit: { livekit_service_url: "https://lk.example.org" },
      });
      const { advertised$, active$ } =
        createLocalTransport$(localTransportOpts);
      openIdResolver.resolve?.(openIdResponse);
      expect(advertised$.value).toBe(null);
      expect(active$.value).toBe(null);
      await flushPromises();
      const expectedTransport = {
        livekit_service_url: "https://lk.example.org",
        type: "livekit",
      };
      expect(advertised$.value).toStrictEqual(expectedTransport);
      expect(active$.value).toStrictEqual({
        transport: expectedTransport,
        sfuConfig: {
          jwt: "e30=.eyJzdWIiOiJAbWU6ZXhhbXBsZS5vcmc6QUJDREVGIiwidmlkZW8iOnsicm9vbSI6IiFleGFtcGxlX3Jvb21faWQifX0=.e30=",
          livekitAlias: "Akph4alDMhen",
          livekitIdentity: "@lk_user:ABCDEF",
          url: "https://lk.example.org",
        },
      });
    });

    it("supports getting transport via user settings", async () => {
      customLivekitUrl.setValue("https://lk.example.org");
      const { advertised$, active$ } =
        createLocalTransport$(localTransportOpts);
      openIdResolver.resolve?.(openIdResponse);
      expect(advertised$.value).toBe(null);
      await flushPromises();
      expect(active$.value).toStrictEqual({
        transport: {
          livekit_service_url: "https://lk.example.org",
          type: "livekit",
        },
        sfuConfig: {
          jwt: "e30=.eyJzdWIiOiJAbWU6ZXhhbXBsZS5vcmc6QUJDREVGIiwidmlkZW8iOnsicm9vbSI6IiFleGFtcGxlX3Jvb21faWQifX0=.e30=",
          livekitAlias: "Akph4alDMhen",
          livekitIdentity: "@lk_user:ABCDEF",
          url: "https://lk.example.org",
        },
      });
    });

    it("supports getting transport via backend", async () => {
      localTransportOpts.client._unstable_getRTCTransports.mockResolvedValue([
        { type: "livekit", livekit_service_url: "https://lk.example.org" },
      ]);
      const { advertised$, active$ } =
        createLocalTransport$(localTransportOpts);
      openIdResolver.resolve?.(openIdResponse);
      expect(advertised$.value).toBe(null);
      expect(active$.value).toBe(null);
      await flushPromises();
      const expectedTransport = {
        livekit_service_url: "https://lk.example.org",
        type: "livekit",
      };
      expect(advertised$.value).toStrictEqual(expectedTransport);
      expect(active$.value).toStrictEqual({
        transport: expectedTransport,
        sfuConfig: {
          jwt: "e30=.eyJzdWIiOiJAbWU6ZXhhbXBsZS5vcmc6QUJDREVGIiwidmlkZW8iOnsicm9vbSI6IiFleGFtcGxlX3Jvb21faWQifX0=.e30=",
          livekitAlias: "Akph4alDMhen",
          livekitIdentity: "@lk_user:ABCDEF",
          url: "https://lk.example.org",
        },
      });
    });

    it("fails fast if the openID request fails for backend config", async () => {
      localTransportOpts.client._unstable_getRTCTransports.mockResolvedValue([
        { type: "livekit", livekit_service_url: "https://lk.example.org" },
      ]);
      openIdResolver.reject(
        new FailToGetOpenIdToken(new Error("Test driven error")),
      );
      const { error$ } = createLocalTransport$(localTransportOpts);
      await flushPromises();
      expect(error$.value).toBeInstanceOf(FailToGetOpenIdToken);
    });

    it("fails if no options are available", async () => {
      const { advertised$, active$, error$ } = createLocalTransport$({
        scope: testScope(),
        ownMembershipIdentity: ownMemberMock,
        roomId: "!example_room_id",
        forceJwtEndpoint: JwtEndpointVersion.Legacy,
        delayId$: constant(null),
        client: {
          getDomain: () => "example.org",
          baseUrl: "https://example.org",
          // eslint-disable-next-line @typescript-eslint/naming-convention
          _unstable_getRTCTransports: async () => Promise.resolve([]),
          // These won't be called in this error path but satisfy the type
          getOpenIdToken: vi.fn(),
          getDeviceId: vi.fn(),
        },
      });
      await flushPromises();

      expect(error$.value).toEqual(
        new MatrixRTCTransportMissingError("example.org"),
      );
      expect(advertised$.value).toBe(null);
      expect(active$.value).toBe(null);
    });
  });

  it("should not update advertised/active transport on delayID changes, but delay Id delegation should be called", async () => {
    // For simplicity, we'll just use the config livekit
    customLivekitUrl.setValue("https://lk.example.org");

    const authCallSpy = vi
      .spyOn(openIDSFU, "getSFUConfigWithOpenID")
      .mockResolvedValue(openIdResponse);

    const delayId$ = state<string | null>(null);

    const { advertised$, active$ } = createLocalTransport$({
      scope: testScope(),
      ownMembershipIdentity: ownMemberMock,
      roomId: "!example_room_id",
      // We want multi-sdu
      forceJwtEndpoint: JwtEndpointVersion.Legacy,
      delayId$: delayId$,
      client: {
        getDomain: () => "example.org",
        baseUrl: "https://example.org",
        // eslint-disable-next-line @typescript-eslint/naming-convention
        _unstable_getRTCTransports: async () => Promise.resolve([]),
        // These won't be called in this error path but satisfy the type
        getOpenIdToken: vi.fn(),
        getDeviceId: vi.fn(),
      },
    });

    const advertisedValues: LivekitTransportConfig[] = [];
    const activeValues: LocalTransportWithSFUConfig[] = [];
    advertised$.subscribe((t) => {
      if (t !== null) advertisedValues.push(t);
    });
    active$.subscribe((t) => {
      if (t !== null) activeValues.push(t);
    });

    await flushPromises();

    // we have now an active and an advertised
    expect(advertisedValues.length).toEqual(1);
    expect(activeValues.length).toEqual(1);
    expect(advertisedValues[0]!.livekit_service_url).toEqual(
      "https://lk.example.org",
    );
    expect(activeValues[0]!.transport.livekit_service_url).toEqual(
      "https://lk.example.org",
    );

    expect(authCallSpy).toHaveBeenCalledTimes(1);
    // Now emits 3 new delays id
    delayId$.value = "delay_id_1";
    await flushPromises();
    delayId$.value = "delay_id_2";
    await flushPromises();
    delayId$.value = "delay_id_3";
    await flushPromises();

    // No new emissions should've happened, it is the same transport.
    expect(advertisedValues.length).toEqual(1);
    expect(activeValues.length).toEqual(1);

    // Still we should have updated the delayID to auth
    expect(authCallSpy).toHaveBeenCalledTimes(4);

    expect(authCallSpy).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        delayId: "delay_id_3",
      }),
      expect.anything(),
    );
  });
});
