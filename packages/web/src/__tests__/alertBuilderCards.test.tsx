import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type {
  AlertConditions,
  AlertType,
  NotificationChannel,
} from "../api/alerts";
import { BasicInfoCard } from "../components/monitoring/AlertBuilder/BasicInfoCard";
import { ConditionsCard } from "../components/monitoring/AlertBuilder/ConditionsCard";
import { NotificationChannelsCard } from "../components/monitoring/AlertBuilder/NotificationChannelsCard";

/**
 * AlertBuilder card components — pure presentational + handler wiring. Rendered
 * directly with controlled props; every conditional field group + each handler
 * is exercised.
 */

describe("<BasicInfoCard />", () => {
  function setup(overrides: Partial<Parameters<typeof BasicInfoCard>[0]> = {}) {
    const props = {
      name: "My Alert",
      setName: vi.fn(),
      type: "address_activity" as AlertType,
      onTypeChange: vi.fn(),
      cooldown: "60",
      setCooldown: vi.fn(),
      enabled: true,
      setEnabled: vi.fn(),
      ...overrides,
    };
    render(<BasicInfoCard {...props} />);
    return props;
  }

  it("updates the name on input", () => {
    const props = setup();
    fireEvent.change(screen.getByPlaceholderText(/Large Transfer Monitor/), {
      target: { value: "Whale watch" },
    });
    expect(props.setName).toHaveBeenCalledWith("Whale watch");
  });

  it("updates the cooldown on input", () => {
    const props = setup();
    fireEvent.change(screen.getByPlaceholderText("60"), {
      target: { value: "120" },
    });
    expect(props.setCooldown).toHaveBeenCalledWith("120");
  });

  it("changing the alert-type dropdown calls onTypeChange", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Alert type" }));
    fireEvent.click(screen.getByRole("option", { name: "Contract Event" }));
    expect(props.onTypeChange).toHaveBeenCalledWith("contract_event");
  });

  it("toggles enabled (currently on → off) and shows the right label", () => {
    const props = setup({ enabled: true });
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    // The enable/disable toggle is the only plain button with no accessible name
    const toggle = screen
      .getAllByRole("button")
      .find((b) => b.className.includes("rounded-full"))!;
    fireEvent.click(toggle);
    expect(props.setEnabled).toHaveBeenCalledWith(false);
  });

  it("shows the Disabled label when enabled=false", () => {
    setup({ enabled: false });
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});

describe("<ConditionsCard />", () => {
  function setup(type: AlertType, conditions: AlertConditions = {}) {
    const setConditions = vi.fn();
    render(
      <ConditionsCard
        type={type}
        conditions={conditions}
        setConditions={setConditions}
      />,
    );
    return setConditions;
  }

  it("renders + edits the watch address for address_activity", () => {
    const set = setup("address_activity");
    const input = screen.getByPlaceholderText(/0x742d35Cc/);
    fireEvent.change(input, { target: { value: "0xabc" } });
    expect(set).toHaveBeenCalledWith({ address: "0xabc" });
  });

  it("renders the watch address for failed_tx too", () => {
    setup("failed_tx");
    expect(screen.getByText("Watch Address")).toBeInTheDocument();
  });

  it("renders contract + event signature fields for contract_event", () => {
    const set = setup("contract_event");
    expect(screen.getByText("Contract Address")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/0xA0b86991/), {
      target: { value: "0xcontract" },
    });
    expect(set).toHaveBeenCalledWith({ contractAddress: "0xcontract" });
    fireEvent.change(screen.getByPlaceholderText(/Transfer\(address/), {
      target: { value: "Transfer(address,address,uint256)" },
    });
    expect(set).toHaveBeenCalledWith({
      eventSignature: "Transfer(address,address,uint256)",
    });
  });

  it("renders contract + selector fields for function_call", () => {
    const set = setup("function_call");
    fireEvent.change(screen.getByPlaceholderText(/0xA0b86991/), {
      target: { value: "0xcontract" },
    });
    expect(set).toHaveBeenCalledWith({ contractAddress: "0xcontract" });
    fireEvent.change(screen.getByPlaceholderText("0xa9059cbb"), {
      target: { value: "0xa9059cbb" },
    });
    expect(set).toHaveBeenCalledWith({ functionSelector: "0xa9059cbb" });
  });

  it("renders threshold + direction for balance_threshold and updates direction", () => {
    const set = setup("balance_threshold", { direction: "below" });
    // the watch-address field also appears for balance_threshold
    fireEvent.change(screen.getByPlaceholderText(/0x742d35Cc/), {
      target: { value: "0xwatch" },
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ address: "0xwatch" }),
    );
    fireEvent.change(screen.getByPlaceholderText("1000"), {
      target: { value: "5000" },
    });
    // patch spreads existing conditions, so direction rides along.
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ threshold: "5000" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Direction" }));
    fireEvent.click(screen.getByRole("option", { name: "Above" }));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "above" }),
    );
  });
});

describe("<NotificationChannelsCard />", () => {
  function setup(notifications: NotificationChannel[] = []) {
    const setNotifications = vi.fn();
    render(
      <NotificationChannelsCard
        notifications={notifications}
        setNotifications={setNotifications}
      />,
    );
    return setNotifications;
  }

  it("shows the empty hint when no channels are configured", () => {
    setup([]);
    expect(
      screen.getByText(/No notification channels configured/),
    ).toBeInTheDocument();
  });

  it("adds a webhook channel via + Add Channel", () => {
    const set = setup([]);
    fireEvent.click(screen.getByRole("button", { name: /Add Channel/ }));
    expect(set).toHaveBeenCalledWith([{ type: "webhook", url: "" }]);
  });

  it("edits a webhook URL (writes both url + webhookUrl)", () => {
    const set = setup([{ type: "webhook", url: "" }]);
    fireEvent.change(screen.getByPlaceholderText("https://..."), {
      target: { value: "https://hooks.example/x" },
    });
    expect(set).toHaveBeenCalledWith([
      {
        type: "webhook",
        url: "https://hooks.example/x",
        webhookUrl: "https://hooks.example/x",
      },
    ]);
  });

  it("labels discord/slack webhook fields with the capitalized name", () => {
    setup([{ type: "discord", url: "" }]);
    expect(screen.getByText("Discord Webhook URL")).toBeInTheDocument();
  });

  it("renders telegram bot-token + chat-id fields and edits them", () => {
    const set = setup([{ type: "telegram" }]);
    fireEvent.change(
      screen.getByPlaceholderText(/123456789:ABCdefGHI/),
      { target: { value: "tok" } },
    );
    expect(set).toHaveBeenCalledWith([{ type: "telegram", botToken: "tok" }]);

    fireEvent.change(screen.getByPlaceholderText("-1001234567890"), {
      target: { value: "-100999" },
    });
    expect(set).toHaveBeenCalledWith([{ type: "telegram", chatId: "-100999" }]);
  });

  it("changing the channel type resets the credential fields", () => {
    const set = setup([{ type: "webhook", url: "x" }]);
    fireEvent.click(screen.getByRole("button", { name: "Channel type" }));
    fireEvent.click(screen.getByRole("option", { name: "Telegram" }));
    expect(set).toHaveBeenCalledWith([
      { type: "telegram", url: "", webhookUrl: "", botToken: "", chatId: "" },
    ]);
  });

  it("removes a channel via its Remove button", () => {
    const set = setup([{ type: "webhook", url: "a" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(set).toHaveBeenCalledWith([]);
  });
});
