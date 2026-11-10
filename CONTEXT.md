# Jeiger

A Geiger counter for anything you can name: sweep a camera around and the clicks speed up and lean toward the thing you are looking for. It exists to try out the image input of TypeSafe's Jev model. It shares nothing with the shop in the rest of this repository.

## Language

**Hunt**:
One search for one Target, from the moment it is named until it is replaced or given up.
_Avoid_: Session, search, scan

**Target**:
What a Hunt is looking for, given as words, as an Exemplar, or as both.
_Avoid_: Query, prompt, object

**Exemplar**:
A photo that shows the Target, taken before the Hunt starts ("find the other sock like this one").
_Avoid_: Reference image, sample, template

**Frame**:
One still picture from the camera, sized to fit Jev's image limits.
_Avoid_: Snapshot, screenshot, image

**Judge**:
Whatever answers "is the Target in this Frame, and where". In real use it is Jev; under test and in the demo it is the Fake Jev.
_Avoid_: Model, detector, API

**Reading**:
The Judge's answer about one Frame: how likely the Target is visible, and a box around where it would be. The box is present even when the Target is absent, so it means nothing on its own.
_Avoid_: Detection, result, response

**Heat**:
How sure Jeiger currently is that the Target is in view, from 0 to 1. It is smoothed over the recent Readings and fades when Readings stop arriving.
_Avoid_: Score, probability, signal

**Bearing**:
Where the Target sits relative to the centre of the view: left or right, up or down, and how much of the view it fills. There is a Bearing only while the Heat is high enough to believe the box.
_Avoid_: Position, direction, location

**Phase**:
The stage of a Hunt, as the person hears it: cold, warm, hot or locked. Locked means the Target is sitting in the centre of the view.
_Avoid_: Status, state, mode

**Click**:
One tick of the counter. Clicks come at random intervals whose average rate rises with the Heat, and each one is panned and pitched by the Bearing.
_Avoid_: Beep, tick, pulse

**Budget**:
The most money one running Jeiger may spend on the Judge. When it is used up, Hunts get no more Readings.
_Avoid_: Quota, limit, cap

**Fake Jev**:
A stand-in for the Jev API that enforces Jev's documented request rules and answers from a script instead of looking at the Frame.
_Avoid_: Mock, stub, simulator
