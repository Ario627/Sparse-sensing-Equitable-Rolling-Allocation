import { describe, expect, it } from "vitest";
import {
  belongsToDevice,
  commandAckTopic,
  commandTopic,
  parseSeraTopic,
  statusTopic,
  telemetryTopic,
} from "./topics.ts";

const endpoint = { site: "demo-01", device: "esp32-01" };

describe("topic builders", () => {
  it("builds the documented channel topics", () => {
    expect(telemetryTopic(endpoint)).toBe("sera/demo-01/esp32-01/telemetry");
    expect(statusTopic(endpoint)).toBe("sera/demo-01/esp32-01/status");
    expect(commandTopic(endpoint)).toBe("sera/demo-01/esp32-01/command");
    expect(commandAckTopic(endpoint)).toBe("sera/demo-01/esp32-01/command/ack");
  });

  it("rejects identifiers outside the lowercase grammar", () => {
    expect(() => telemetryTopic({ site: "DEMO", device: "esp32-01" })).toThrow(
      RangeError,
    );
    expect(() => telemetryTopic({ site: "demo-01", device: "-esp32" })).toThrow(
      RangeError,
    );
    expect(() =>
      telemetryTopic({ site: "demo-01", device: "esp32-01-" }),
    ).toThrow(RangeError);
  });
});

describe("parseSeraTopic", () => {
  it("round-trips every channel kind", () => {
    expect(parseSeraTopic(telemetryTopic(endpoint))).toEqual({
      kind: "telemetry",
      ...endpoint,
    });
    expect(parseSeraTopic(statusTopic(endpoint))).toEqual({
      kind: "status",
      ...endpoint,
    });
    expect(parseSeraTopic(commandTopic(endpoint))).toEqual({
      kind: "command",
      ...endpoint,
    });
    expect(parseSeraTopic(commandAckTopic(endpoint))).toEqual({
      kind: "commandAck",
      ...endpoint,
    });
  });

  it("rejects foreign prefixes, unknown channels, and wrong depth", () => {
    expect(parseSeraTopic("other/demo-01/esp32-01/telemetry")).toBeNull();
    expect(parseSeraTopic("sera/demo-01/esp32-01/unknown")).toBeNull();
    expect(parseSeraTopic("sera/demo-01/esp32-01")).toBeNull();
    expect(parseSeraTopic("sera/demo-01/esp32-01/telemetry/extra")).toBeNull();
    expect(
      parseSeraTopic("sera/demo-01/esp32-01/command/ack/extra"),
    ).toBeNull();
  });

  it("rejects wildcard and uppercase segments", () => {
    expect(parseSeraTopic("sera/demo-01/+/telemetry")).toBeNull();
    expect(parseSeraTopic("sera/demo-01/esp32-01/#")).toBeNull();
    expect(parseSeraTopic("sera/Demo-01/esp32-01/telemetry")).toBeNull();
  });
});

describe("belongsToDevice", () => {
  it("accepts only topics owned by the endpoint", () => {
    expect(belongsToDevice("sera/demo-01/esp32-01/telemetry", endpoint)).toBe(
      true,
    );
    expect(belongsToDevice("sera/demo-01/esp32-01/command", endpoint)).toBe(
      true,
    );
    expect(belongsToDevice("sera/demo-01/esp32-02/telemetry", endpoint)).toBe(
      false,
    );
    expect(belongsToDevice("sera/demo-02/esp32-01/telemetry", endpoint)).toBe(
      false,
    );
    expect(belongsToDevice("sera/demo-01/esp32-01", endpoint)).toBe(false);
  });
});
