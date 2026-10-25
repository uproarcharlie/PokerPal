import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { fakeMediaStream } from "@test/helpers/media";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { CameraDialog } from "./camera-dialog";
import { CAMERA_BLOCKED_MESSAGE, CAMERA_BUSY_MESSAGE, CAMERA_ERROR_MESSAGE, NO_CAMERA_MESSAGE } from "./use-camera-capture";

const getUserMedia = () => vi.mocked(navigator.mediaDevices.getUserMedia);

/** The streams the camera was given, in order. */
async function grantedStreams(): Promise<MediaStream[]> {
  return Promise.all(getUserMedia().mock.results.map((result) => result.value as Promise<MediaStream>));
}

function Harness({ onCapture = vi.fn(), onChooseFile = vi.fn() }: { onCapture?: (photo: Blob) => void; onChooseFile?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "camera open" : "camera closed"}</p>
      <CameraDialog open={open} onOpenChange={setOpen} onCapture={onCapture} onChooseFile={onChooseFile} />
    </>
  );
}

/** What a real <video> has once the first frame is in. */
function firstFrame(video: HTMLVideoElement) {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 1280 });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 720 });
  fireEvent.loadedData(video);
}

afterEach(() => getUserMedia().mockClear());

describe("CameraDialog", () => {
  it("asks for the front camera in full HD, mirrors its preview, and captures once the first frame is in", async () => {
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} />);
    const dialog = await screen.findByRole("dialog", { name: "Take a photo" });

    expect(getUserMedia()).toHaveBeenCalledWith({
      video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    const capture = within(dialog).getByRole("button", { name: "Capture" });
    expect(capture).toBeDisabled();

    const video = dialog.querySelector("video") as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).not.toBeNull());
    expect(video).toHaveClass("-scale-x-100");
    firstFrame(video);
    expect(capture).toBeEnabled();

    await userEvent.click(capture);

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(expect.any(Blob)));
    expect(screen.getByText("camera closed")).toBeInTheDocument();
    const [stream] = await grantedStreams();
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it("keeps the front camera's photo the right way round: only its preview is mirrored (P3REV-IMG-MIRRORED-SELFIE)", async () => {
    const drawn = { drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(), transform: vi.fn() };
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(drawn as unknown as CanvasRenderingContext2D);
    onTestFinished(() => getContext.mockRestore());
    const onCapture = vi.fn();
    render(<Harness onCapture={onCapture} />);
    const dialog = await screen.findByRole("dialog", { name: "Take a photo" });
    const video = dialog.querySelector("video") as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).not.toBeNull());
    expect(video).toHaveClass("-scale-x-100");
    firstFrame(video);

    await userEvent.click(within(dialog).getByRole("button", { name: "Capture" }));

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(expect.any(Blob)));
    expect(drawn.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    for (const flip of [drawn.translate, drawn.scale, drawn.setTransform, drawn.transform]) expect(flip).not.toHaveBeenCalled();
  });

  it("switches to the back camera, releasing the front one", async () => {
    render(<Harness />);
    const dialog = await screen.findByRole("dialog", { name: "Take a photo" });
    await waitFor(() => expect(getUserMedia()).toHaveBeenCalledTimes(1));

    await userEvent.click(within(dialog).getByRole("button", { name: "Switch camera" }));

    await waitFor(() => expect(getUserMedia()).toHaveBeenCalledTimes(2));
    expect(getUserMedia().mock.calls[1][0]).toMatchObject({ video: { facingMode: "environment" } });
    const [front] = await grantedStreams();
    expect(front.getTracks()[0].stop).toHaveBeenCalled();
    await waitFor(() => expect((dialog.querySelector("video") as HTMLVideoElement).className).not.toContain("-scale-x-100"));
  });

  it("stops a camera that only answers after the dialog has closed", async () => {
    let grant: (stream: MediaStream) => void = () => {};
    getUserMedia().mockImplementationOnce(() => new Promise<MediaStream>((resolve) => (grant = resolve)));
    render(<Harness />);
    await screen.findByRole("dialog", { name: "Take a photo" });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const late = fakeMediaStream();
    await act(async () => grant(late));

    expect(late.getTracks()[0].stop).toHaveBeenCalled();
  });

  it("releases the camera when the page goes away", async () => {
    const { unmount } = render(<Harness />);
    await screen.findByRole("dialog", { name: "Take a photo" });
    const [stream] = await grantedStreams();

    unmount();

    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it("offers an upload instead when the camera is blocked", async () => {
    getUserMedia().mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    const onChooseFile = vi.fn();
    render(<Harness onChooseFile={onChooseFile} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(CAMERA_BLOCKED_MESSAGE);
    await userEvent.click(screen.getByRole("button", { name: "Upload a photo instead" }));

    expect(onChooseFile).toHaveBeenCalled();
    expect(screen.getByText("camera closed")).toBeInTheDocument();
  });

  it.each([
    ["NotFoundError", NO_CAMERA_MESSAGE],
    ["OverconstrainedError", NO_CAMERA_MESSAGE],
    ["NotReadableError", CAMERA_BUSY_MESSAGE],
    ["SecurityError", CAMERA_BLOCKED_MESSAGE],
    ["UnknownError", CAMERA_ERROR_MESSAGE],
  ])("says plainly why the camera did not open (%s)", async (reason, message) => {
    getUserMedia().mockRejectedValueOnce(new DOMException("No", reason));
    render(<Harness />);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Upload a photo instead" })).toBeVisible();
  });

  it("asks for the camera again from Try again, once it is free or allowed", async () => {
    getUserMedia().mockRejectedValueOnce(new DOMException("Busy", "NotReadableError"));
    render(<Harness />);
    await screen.findByRole("alert");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(getUserMedia()).toHaveBeenCalledTimes(2));
    expect(getUserMedia().mock.calls[1][0]).toMatchObject({ video: { facingMode: "user" } });
    expect(await screen.findByRole("button", { name: "Capture" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("fills a phone's screen, and shows a circle to put a face in once the front camera's picture is in", async () => {
    function Selfie() {
      const [open, setOpen] = useState(true);
      return <CameraDialog open={open} onOpenChange={setOpen} onCapture={() => {}} onChooseFile={() => {}} title="Take a selfie" />;
    }
    render(<Selfie />);
    const dialog = await screen.findByRole("dialog", { name: "Take a selfie" });

    expect(dialog).toHaveClass("h-dvh", "max-w-none", "sm:max-w-xl");
    expect(screen.queryByTestId("face-guide")).not.toBeInTheDocument();
    const video = dialog.querySelector("video") as HTMLVideoElement;
    await waitFor(() => expect(video.srcObject).not.toBeNull());
    firstFrame(video);
    expect(screen.getByTestId("face-guide")).toHaveAttribute("aria-hidden", "true");
    // Capture is the big button within thumb reach, and every control is a 44 px target or more.
    expect(within(dialog).getByRole("button", { name: "Capture" })).toHaveClass("h-14");
    for (const name of ["Cancel", "Switch camera"]) expect(within(dialog).getByRole("button", { name })).toHaveClass("h-12");

    await userEvent.click(within(dialog).getByRole("button", { name: "Switch camera" }));
    await waitFor(() => expect(screen.queryByTestId("face-guide")).not.toBeInTheDocument());
  });

  it("closes on Escape without closing the form sheet it was opened from", async () => {
    function SheetHarness() {
      const [sheet, setSheet] = useState(true);
      const [camera, setCamera] = useState(true);
      return (
        <Sheet open={sheet} onOpenChange={setSheet}>
          <SheetContent>
            <SheetTitle>Edit player</SheetTitle>
            <SheetDescription>Their details</SheetDescription>
            <p>{camera ? "camera open" : "camera closed"}</p>
            <CameraDialog open={camera} onOpenChange={setCamera} onCapture={() => {}} onChooseFile={() => {}} />
          </SheetContent>
        </Sheet>
      );
    }
    render(<SheetHarness />);
    await screen.findByRole("dialog", { name: "Take a photo" });

    await userEvent.keyboard("{Escape}");

    expect(await screen.findByText("camera closed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit player" })).toBeInTheDocument();
  });
});
