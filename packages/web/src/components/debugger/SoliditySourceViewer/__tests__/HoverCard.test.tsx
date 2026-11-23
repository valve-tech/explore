import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SourceViewer from "../../SoliditySourceViewer";

// One line of the WETH9 source (mainnet 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2).
const file = { name: "WETH9.sol", content: "    function withdraw(uint wad) public {" };

function token(text: string) {
  return screen.getAllByText(text).find((el) => el.tagName === "SPAN")!;
}

describe("source hover card", () => {
  it("shows the value at the current step and the click hint", () => {
    render(
      <SourceViewer
        file={file}
        currentLine={1}
        onTokenClick={() => {}}
        describeToken={(pos) => (pos.col === 27 ? "Go to the declaration" : null)}
        hoverValue={(pos) =>
          pos.col === 27 ? { name: "wad", type: "uint256", value: "1000000000000000000", source: "stack" } : null
        }
      />,
    );
    fireEvent.mouseEnter(token("wad"));
    expect(screen.getByTestId("source-hover-value").textContent).toBe("1000000000000000000");
    expect(screen.getByTestId("source-hover-card").textContent).toContain("Go to the declaration");
    fireEvent.mouseLeave(token("wad"));
    expect(screen.queryByTestId("source-hover-card")).toBeNull();
  });

  it("shows no card when the token has neither a value nor a hint", () => {
    render(<SourceViewer file={file} currentLine={1} onTokenClick={() => {}} describeToken={() => null} hoverValue={() => null} />);
    fireEvent.mouseEnter(token("withdraw"));
    expect(screen.queryByTestId("source-hover-card")).toBeNull();
  });
});
