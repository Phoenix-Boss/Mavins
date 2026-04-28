module.exports = {
  dependencies: {
    'mavin-player': {
      root: __dirname + '/modules/mavin-player',
      platforms: {
        android: {
          sourceDir: './modules/mavin-player/android',
          packageImportPath: 'import com.doublesymmetry.trackplayer.TrackPlayerPackage;',
          packageInstance: 'new TrackPlayerPackage()' 
        }
      }
    }
  }
};
