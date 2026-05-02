import os

with open("src/systems/weather/weather.ts", "r") as f:
    content = f.read()

content = content.replace("this.ecosystemManager.handleSpawning(time, fungiFavorability, lanternFavorability, globalLight, this.onSpawnFoliage);", "const isRaining = this.state === WeatherState.RAIN || this.state === WeatherState.STORM;\n        this.ecosystemManager.handleSpawning(time, fungiFavorability, lanternFavorability, globalLight, this.onSpawnFoliage, isRaining);")
content = content.replace("this.ecosystemManager.handleSpawning(time, fungiScore, lanternScore, globalLight, this.onSpawnFoliage);", "const isRaining = this.state === WeatherState.RAIN || this.state === WeatherState.STORM;\n        this.ecosystemManager.handleSpawning(time, fungiScore, lanternScore, globalLight, this.onSpawnFoliage, isRaining);")

with open("src/systems/weather/weather.ts", "w") as f:
    f.write(content)
