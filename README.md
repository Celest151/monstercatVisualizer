# monstercatVisualizer
A desktop Monstercat-style audio visualizer for Windows.

This visualizer is intended to resemble the one in the official Monstercat videos.
The project [audioMotion-analyzer](https://github.com/hvianna/audioMotion-analyzer) is used for this.


# Install
Install dependencies:

```sh
npm install
```

Start the desktop app:

```sh
npm start
```

The app opens the visualizer in one Windows desktop window and a separate library/player window. Use the library window's File button or drag audio files onto the library window to add songs, then double-click a track or press Playback to play it through the visualizer window.

It also starts the local stream proxy that the visualizer can use for remote songs.

Recording mode is available from the library window's Recording menu. Choose an output folder, then record the selected track or the whole playlist. Recordings default to 1920x1080 at 60fps and include the original song audio.

If you still want the old browser workflow, start only the local server:

```sh
npm run server
```

Insert your songs into the `./audio/` folder, add a suitable cover image to `./cover/`, and adjust the `./settings.js` file.

# Preview
The videos below are not pre-rendered.

https://github.com/user-attachments/assets/37b08c23-96d1-4b92-b6e3-7c34084d86ed

You can also activate particles in the settings

https://github.com/user-attachments/assets/5a030c3d-f606-41e0-9d37-6a91ed12bfee

**Disclaimer: This version is not official and was not commissioned by Monstercat or the artists. It serves only as a learning project.**

