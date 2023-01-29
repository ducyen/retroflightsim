import * as THREE from 'three';
import { COCKPIT_FOV, PLANE_DISTANCE_TO_GROUND, H_RES, TERRAIN_MODEL_SIZE, TERRAIN_SCALE, V_RES, COCKPIT_FAR, LO_H_RES, LO_V_RES, HI_H_RES, HI_V_RES } from '../defs';
import { Renderer, RenderLayer, RenderTargetType } from "../render/renderer";
import { SceneCamera } from '../scene/cameras/camera';
import { CockpitFrontCameraUpdater } from './cameraUpdaters/cockpitFrontCameraUpdater';
import { GroundTargetEntity } from '../scene/entities/groundTarget';
import { CockpitEntity, CockpitMFD1X, CockpitMFD1Y, CockpitMFD2X, CockpitMFD2Y, CockpitMFDSizeX, CockpitMFDSizeY } from '../scene/entities/overlay/cockpit';
import { HUDEntity } from '../scene/entities/overlay/hud';
import { PlayerEntity } from '../scene/entities/player';
import { SceneryField, SceneryFieldSettings } from '../scene/entities/sceneryField';
import { SimpleEntity } from '../scene/entities/simpleEntity';
import { SpecklesEntity } from '../scene/entities/speckles';
import { StaticSceneryEntity } from '../scene/entities/staticScenery';
import { SceneMaterialManager } from "../scene/materials/materials";
import { ModelManager } from "../scene/models/models";
import { VGAMidnightPalette } from '../config/palettes/vga-midnight';
import { VGANoonPalette } from '../config/palettes/vga-noon';
import { Palette, PaletteCategory, PaletteColor } from '../config/palettes/palette';
import { RIGHT, Scene, SceneLayers, UP } from '../scene/scene';
import { assertIsDefined } from '../utils/asserts';
import { Entity } from '../scene/entity';
import { CameraUpdater } from './cameraUpdaters/cameraUpdater';
import { ExteriorBehindCameraUpdater } from './cameraUpdaters/exteriorBehindCameraUpdater';
import { ExteriorDataEntity } from '../scene/entities/overlay/exteriorData';
import { ExteriorSide, ExteriorSideCameraUpdater } from './cameraUpdaters/exteriorSideCameraUpdater';
import { KernelTask } from '../core/kernel';
import { TargetToCameraUpdater } from './cameraUpdaters/targetToCameraUpdater';
import { restoreMainCameraParameters } from './stateUtils';
import { TargetFromCameraUpdater } from './cameraUpdaters/targetFromCameraUpdater';
import { ConfigService } from '../config/configService';
import { DisplayResolution, FogQuality } from '../config/profiles/profile';
import { CGANoonPalette } from '../config/palettes/cga-noon';
import { EGANoonPalette } from '../config/palettes/ega-noon';
import { EGAMidnightPalette } from '../config/palettes/ega-midnight';
import { SVGANoonPalette } from '../config/palettes/svga-noon';
import { SVGAMidnightPalette } from '../config/palettes/svga-midnight';
import { CGAMidnightPalette } from '../config/palettes/cga-midnight';
import { AudioSystem } from '../audio/audioSystem';


const MAIN_RENDER_TARGET_LO = 'MAIN_RENDER_TARGET_LO';
const CANVAS_RENDER_TARGET_LO = 'CANVAS_RENDER_TARGET_LO';
const MAIN_RENDER_TARGET_HI = 'MAIN_RENDER_TARGET_HI';
const CANVAS_RENDER_TARGET_HI = 'CANVAS_RENDER_TARGET_HI';
const WEAPONSTARGET_RENDER_TARGET_LO = 'WEAPONSTARGET_RENDER_TARGET_LO';
const MAP_RENDER_TARGET_LO = 'MAP_RENDER_TARGET_LO';
const WEAPONSTARGET_RENDER_TARGET_HI = 'WEAPONSTARGET_RENDER_TARGET_HI';
const MAP_RENDER_TARGET_HI = 'MAP_RENDER_TARGET_HI';

enum PlayerViewState {
    COCKPIT_FRONT,
    EXTERIOR_BEHIND,
    EXTERIOR_LEFT,
    EXTERIOR_RIGHT,
    TARGET_TO,
    TARGET_FROM,
}

export class GameUpdateTask implements KernelTask {

    constructor(private game: Game) { }

    update(delta: number) {
        this.game.update(delta);
    }
}

export class GameRenderTask implements KernelTask {

    constructor(private game: Game) { }

    update(delta: number) {
        this.game.render();
    }
}

export class Game {

    private scene: Scene = new Scene();

    private playerCamera: SceneCamera;
    private targetCamera: SceneCamera;
    private mapCamera: THREE.OrthographicCamera;
    private cameraUpdaters: Map<PlayerViewState, CameraUpdater> = new Map();
    private cameraUpdater: CameraUpdater;
    private player: PlayerEntity;

    private palettes = [VGANoonPalette, VGAMidnightPalette];
    private currentPalette = 0;

    private cockpitRenderLayersLo: RenderLayer[];
    private cockpitTargetRenderLayersLo: RenderLayer[];
    private exteriorRenderLayersLo: RenderLayer[];
    private cockpitRenderLayersHi: RenderLayer[];
    private cockpitTargetRenderLayersHi: RenderLayer[];
    private exteriorRenderLayersHi: RenderLayer[];

    private view: PlayerViewState = PlayerViewState.COCKPIT_FRONT;

    private cockpitEntities: Entity[] = [];
    private exteriorEntities: Entity[] = [];

    constructor(private configService: ConfigService, private models: ModelManager, private materials: SceneMaterialManager, private renderer: Renderer,
        private audio: AudioSystem) {

        this.playerCamera = new SceneCamera(new THREE.PerspectiveCamera(COCKPIT_FOV, H_RES / V_RES, PLANE_DISTANCE_TO_GROUND, COCKPIT_FAR));
        this.targetCamera = new SceneCamera(new THREE.PerspectiveCamera(COCKPIT_FOV, 1, PLANE_DISTANCE_TO_GROUND, COCKPIT_FAR));
        this.mapCamera = new THREE.OrthographicCamera(-10000, 10000, 10000, -10000, 10, 1000);
        this.mapCamera.setRotationFromAxisAngle(RIGHT, -Math.PI / 2);
        this.mapCamera.position.set(0, 500, 0);
        this.player = new PlayerEntity(
            this.models.getModel('assets/f22.glb'),
            this.models.getModel('assets/f22_shadow.gltf'),
            this.audio.getGlobal('assets/engine-loop-02.ogg', true),
            this.audio.getGlobal('assets/engine-loop-01.ogg', true),
            new THREE.Vector3(1500, PLANE_DISTANCE_TO_GROUND, -1160), Math.PI);
        this.cameraUpdaters.set(PlayerViewState.COCKPIT_FRONT, new CockpitFrontCameraUpdater(this.player, this.playerCamera.main));
        this.cameraUpdaters.set(PlayerViewState.EXTERIOR_BEHIND, new ExteriorBehindCameraUpdater(this.player, this.playerCamera.main));
        this.cameraUpdaters.set(PlayerViewState.EXTERIOR_LEFT, new ExteriorSideCameraUpdater(this.player, this.playerCamera.main, ExteriorSide.LEFT));
        this.cameraUpdaters.set(PlayerViewState.EXTERIOR_RIGHT, new ExteriorSideCameraUpdater(this.player, this.playerCamera.main, ExteriorSide.RIGHT));
        this.cameraUpdaters.set(PlayerViewState.TARGET_TO, new TargetToCameraUpdater(this.player, this.playerCamera.main));
        this.cameraUpdaters.set(PlayerViewState.TARGET_FROM, new TargetFromCameraUpdater(this.player, this.playerCamera.main));
        this.cameraUpdater = this.getCameraUpdater(this.view);
        this.configService.addChangeListener(profile => {
            if (profile.resolution === DisplayResolution.LO_RES) {
                this.renderer.setComposeSize(LO_H_RES, LO_V_RES);
            } else {
                this.renderer.setComposeSize(HI_H_RES, HI_V_RES);
            }
            this.palettes = [profile.noonPalette, profile.midnightPalette];
            this.materials.setPalette(this.getPalette());
            this.materials.setFog(profile.fogQuality);
            this.materials.setShadingType(profile.shading);
            this.renderer.setPalette(this.getPalette());
            this.renderer.setTextEffect(profile.textEffect);
        });

        const playerLayersLo: RenderLayer[] = [
            {
                target: MAIN_RENDER_TARGET_LO,
                camera: this.playerCamera.bgSky,
                lists: [SceneLayers.BackgroundSky]
            },
            {
                target: MAIN_RENDER_TARGET_LO,
                camera: this.playerCamera.bgGround,
                lists: [SceneLayers.BackgroundGround]
            },
            {
                target: MAIN_RENDER_TARGET_LO,
                camera: this.playerCamera.main,
                lists: [SceneLayers.Terrain, SceneLayers.EntityFlats, SceneLayers.EntityVolumes]
            }
        ];
        const playerLayersHi: RenderLayer[] = [
            {
                target: MAIN_RENDER_TARGET_HI,
                camera: this.playerCamera.bgSky,
                lists: [SceneLayers.BackgroundSky]
            },
            {
                target: MAIN_RENDER_TARGET_HI,
                camera: this.playerCamera.bgGround,
                lists: [SceneLayers.BackgroundGround]
            },
            {
                target: MAIN_RENDER_TARGET_HI,
                camera: this.playerCamera.main,
                lists: [SceneLayers.Terrain, SceneLayers.EntityFlats, SceneLayers.EntityVolumes]
            }
        ];
        const targetLayersLo: RenderLayer[] = [
            {
                target: WEAPONSTARGET_RENDER_TARGET_LO,
                camera: this.targetCamera.bgSky,
                lists: [SceneLayers.BackgroundSky]
            },
            {
                target: WEAPONSTARGET_RENDER_TARGET_LO,
                camera: this.targetCamera.bgGround,
                lists: [SceneLayers.BackgroundGround]
            },
            {
                target: WEAPONSTARGET_RENDER_TARGET_LO,
                camera: this.targetCamera.main,
                lists: [SceneLayers.Terrain, SceneLayers.EntityFlats, SceneLayers.EntityVolumes]
            }
        ];
        const targetLayersHi: RenderLayer[] = [
            {
                target: WEAPONSTARGET_RENDER_TARGET_HI,
                camera: this.targetCamera.bgSky,
                lists: [SceneLayers.BackgroundSky]
            },
            {
                target: WEAPONSTARGET_RENDER_TARGET_HI,
                camera: this.targetCamera.bgGround,
                lists: [SceneLayers.BackgroundGround]
            },
            {
                target: WEAPONSTARGET_RENDER_TARGET_HI,
                camera: this.targetCamera.main,
                lists: [SceneLayers.Terrain, SceneLayers.EntityFlats, SceneLayers.EntityVolumes]
            }
        ];
        const mapLayersLo: RenderLayer[] = [
            {
                target: MAP_RENDER_TARGET_LO,
                camera: this.mapCamera,
                lists: [SceneLayers.Terrain]
            }
        ];
        const mapLayersHi: RenderLayer[] = [
            {
                target: MAP_RENDER_TARGET_HI,
                camera: this.mapCamera,
                lists: [SceneLayers.Terrain]
            }
        ];
        const canvasLayersLo: RenderLayer[] = [
            {
                target: CANVAS_RENDER_TARGET_LO,
                camera: this.playerCamera.main,
                lists: [SceneLayers.Overlay]
            }
        ];
        const canvasLayersHi: RenderLayer[] = [
            {
                target: CANVAS_RENDER_TARGET_HI,
                camera: this.playerCamera.main,
                lists: [SceneLayers.Overlay]
            }
        ];
        this.cockpitRenderLayersLo = [...playerLayersLo, ...mapLayersLo, ...canvasLayersLo];
        this.cockpitTargetRenderLayersLo = [...playerLayersLo, ...mapLayersLo, ...targetLayersLo, ...canvasLayersLo];
        this.exteriorRenderLayersLo = [...playerLayersLo, ...canvasLayersLo];
        this.cockpitRenderLayersHi = [...playerLayersHi, ...mapLayersHi, ...canvasLayersHi];
        this.cockpitTargetRenderLayersHi = [...playerLayersHi, ...mapLayersHi, ...targetLayersHi, ...canvasLayersHi];
        this.exteriorRenderLayersHi = [...playerLayersHi, ...canvasLayersHi];
    }

    setup() {
        const textColors = Array.from(new Set(
            [CGANoonPalette, CGAMidnightPalette, EGANoonPalette, EGAMidnightPalette, VGANoonPalette, VGAMidnightPalette, SVGANoonPalette, SVGAMidnightPalette]
                .flatMap(p => ([PaletteColor(p, PaletteCategory.HUD_TEXT), PaletteColor(p, PaletteCategory.HUD_TEXT_EFFECT)]))
        ));

        this.renderer.createRenderTarget(MAIN_RENDER_TARGET_LO, RenderTargetType.WEBGL, 0, 0, LO_H_RES, LO_V_RES);
        this.renderer.createRenderTarget(CANVAS_RENDER_TARGET_LO, RenderTargetType.CANVAS, 0, 0, LO_H_RES, LO_V_RES, { textColors });
        this.renderer.createRenderTarget(MAIN_RENDER_TARGET_HI, RenderTargetType.WEBGL, 0, 0, HI_H_RES, HI_V_RES);
        this.renderer.createRenderTarget(CANVAS_RENDER_TARGET_HI, RenderTargetType.CANVAS, 0, 0, HI_H_RES, HI_V_RES, { textColors });
        const LO_MFD_SIZE_X = CockpitMFDSizeX(LO_V_RES);
        const LO_MFD_SIZE_Y = CockpitMFDSizeY(LO_V_RES);
        this.renderer.createRenderTarget(MAP_RENDER_TARGET_LO, RenderTargetType.WEBGL, CockpitMFD1X(LO_H_RES, LO_V_RES, LO_MFD_SIZE_X), CockpitMFD1Y(LO_H_RES, LO_V_RES, LO_MFD_SIZE_X), LO_MFD_SIZE_X, LO_MFD_SIZE_Y);
        this.renderer.createRenderTarget(WEAPONSTARGET_RENDER_TARGET_LO, RenderTargetType.WEBGL, CockpitMFD2X(LO_H_RES, LO_V_RES, LO_MFD_SIZE_X), CockpitMFD2Y(LO_H_RES, LO_V_RES, LO_MFD_SIZE_X), LO_MFD_SIZE_X, LO_MFD_SIZE_Y);
        const HI_MFD_SIZE_X = CockpitMFDSizeX(HI_V_RES);
        const HI_MFD_SIZE_Y = CockpitMFDSizeY(HI_V_RES);
        this.renderer.createRenderTarget(MAP_RENDER_TARGET_HI, RenderTargetType.WEBGL, CockpitMFD1X(HI_H_RES, HI_V_RES, LO_MFD_SIZE_X), CockpitMFD1Y(HI_H_RES, HI_V_RES, LO_MFD_SIZE_X), LO_MFD_SIZE_X, LO_MFD_SIZE_Y);
        this.renderer.createRenderTarget(WEAPONSTARGET_RENDER_TARGET_HI, RenderTargetType.WEBGL, CockpitMFD2X(HI_H_RES, HI_V_RES, LO_MFD_SIZE_X), CockpitMFD2Y(HI_H_RES, HI_V_RES, LO_MFD_SIZE_X), LO_MFD_SIZE_X, LO_MFD_SIZE_Y);
        this.renderer.setPalette(this.getPalette());
        this.materials.setPalette(this.getPalette());
        this.setupControls();
        this.setupScene();
    }

    update(delta: number) {
        if ((this.view === PlayerViewState.TARGET_TO || this.view === PlayerViewState.TARGET_FROM) && !this.player.weaponsTarget) {
            this.setCockpitFrontView();
        }

        this.scene.update(delta);
        this.cameraUpdater.update(delta);
        this.playerCamera.update();
        this.targetCamera.update();
    }

    render() {
        const isLowRes = this.configService.getProfile().resolution === DisplayResolution.LO_RES;

        let layers = isLowRes ? this.cockpitRenderLayersLo : this.cockpitRenderLayersHi;
        if (this.view !== PlayerViewState.COCKPIT_FRONT) {
            layers = isLowRes ? this.exteriorRenderLayersLo : this.exteriorRenderLayersHi;
        } else if (this.player.weaponsTarget) {
            layers = isLowRes ? this.cockpitTargetRenderLayersLo : this.cockpitTargetRenderLayersHi;
        }
        this.renderer.render(this.scene, layers);
    }

    getPlayer(): PlayerEntity {
        return this.player;
    }

    private setupControls() {
        document.addEventListener('keypress', (event: KeyboardEvent) => {
            switch (event.key) {
                case 'n': {
                    this.currentPalette = (this.currentPalette + 1) % this.palettes.length;
                    this.materials.setPalette(this.getPalette());
                    this.renderer.setPalette(this.getPalette());
                    break;
                }
                case '1': {
                    if (this.view !== PlayerViewState.COCKPIT_FRONT) {
                        this.setCockpitFrontView();
                    }
                    break;
                }
                case '2': {
                    if (this.view !== PlayerViewState.EXTERIOR_BEHIND) {
                        this.setExteriorBehindView();
                    }
                    break;
                }
                case '3': {
                    this.setExteriorSideView();
                    break;
                }
                case '4': {
                    if (this.player.weaponsTarget) {
                        this.setTargetView();
                    }
                    break;
                }
            }
        });
    }

    private setCockpitFrontView() {
        restoreMainCameraParameters(this.playerCamera.main);
        this.view = PlayerViewState.COCKPIT_FRONT;
        this.player.exteriorView = false;
        this.cameraUpdater = this.getCameraUpdater(this.view);
        for (let i = 0; i < this.cockpitEntities.length; i++) {
            this.cockpitEntities[i].enabled = true;
        }
        for (let i = 0; i < this.exteriorEntities.length; i++) {
            this.exteriorEntities[i].enabled = false;
        }
    }

    private setExteriorBehindView() {
        restoreMainCameraParameters(this.playerCamera.main);
        this.setExteriorView(PlayerViewState.EXTERIOR_BEHIND);
    }

    private setExteriorSideView() {
        restoreMainCameraParameters(this.playerCamera.main);
        if (this.view !== PlayerViewState.EXTERIOR_RIGHT) {
            this.setExteriorView(PlayerViewState.EXTERIOR_RIGHT);
        } else {
            this.setExteriorView(PlayerViewState.EXTERIOR_LEFT);
        }
    }

    private setTargetView() {
        restoreMainCameraParameters(this.playerCamera.main);
        if (this.view !== PlayerViewState.TARGET_TO) {
            this.setExteriorView(PlayerViewState.TARGET_TO);
        } else {
            this.setExteriorView(PlayerViewState.TARGET_FROM);
        }
    }

    private setExteriorView(view: PlayerViewState) {
        this.view = view;
        this.player.exteriorView = true;
        this.cameraUpdater = this.getCameraUpdater(this.view);
        for (let i = 0; i < this.cockpitEntities.length; i++) {
            this.cockpitEntities[i].enabled = false;
        }
        for (let i = 0; i < this.exteriorEntities.length; i++) {
            this.exteriorEntities[i].enabled = true;
        }
    }

    private getCameraUpdater(view: PlayerViewState): CameraUpdater {
        const updater = this.cameraUpdaters.get(view);
        assertIsDefined(updater);
        return updater;
    }

    private setupScene() {
        const ground = new SimpleEntity(this.models.getModel('lib:GROUND'), SceneLayers.BackgroundGround, SceneLayers.BackgroundGround);
        this.scene.add(ground);

        const sky = new SimpleEntity(this.models.getModel('lib:SKY'), SceneLayers.BackgroundSky, SceneLayers.BackgroundSky);
        sky.position.set(0, 7, 0);
        this.scene.add(sky);

        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                const model = this.models.getModel('assets/map.gltf');
                const map = new SimpleEntity(model, SceneLayers.Terrain, SceneLayers.Terrain);
                map.position.x = x * TERRAIN_MODEL_SIZE * TERRAIN_SCALE;
                map.position.z = z * TERRAIN_MODEL_SIZE * TERRAIN_SCALE;
                map.scale.x = TERRAIN_SCALE * (Math.abs(x) % 2 === 0 ? 1 : -1);
                map.scale.z = TERRAIN_SCALE * (Math.abs(z) % 2 === 0 ? 1 : -1);
                this.scene.add(map);
            }
        }

        this.models.getModel('assets/map.gltf', (url, model) => {
            const grass = model.lod[0].flats.find(mesh => mesh.name === PaletteCategory.TERRAIN_GRASS);
            assertIsDefined(grass);
            for (let i = 0; i < 30; i++) {
                const hill = new StaticSceneryEntity(this.models.getModel('lib:hill'));
                this.randomPosOver(grass, hill.position, 20000);
                hill.scale.set(
                    0.8 + Math.random() / 5.0,
                    0.5 + Math.random() / 2.0,
                    0.8 + Math.random() / 5.0);
                hill.quaternion.setFromAxisAngle(UP, Math.PI / 4 + (Math.random() - 0.5) * Math.PI / 4);
                this.scene.add(hill);
            }

            const bare = model.lod[0].flats.find(mesh => mesh.name === PaletteCategory.TERRAIN_BARE);
            assertIsDefined(bare);
            for (let i = 0; i < 20; i++) {
                const mountain = new StaticSceneryEntity(this.models.getModel('lib:mountain'));
                this.randomPosOver(bare, mountain.position, 20000);
                mountain.scale.x = 0.8 + Math.random() / 5.0;
                mountain.scale.y = 0.5 + Math.random() / 2.0;
                mountain.scale.z = 0.8 + Math.random() / 5.0;
                mountain.quaternion.setFromAxisAngle(UP, Math.PI / 4 + (Math.random() - 0.5) * Math.PI / 4);
                this.scene.add(mountain);
            }
        });

        const speckles = new SpecklesEntity(this.materials);
        this.scene.add(speckles);

        const fieldOptions: SceneryFieldSettings = {
            tilesInField: 7,
            cellsInTile: 2,
            tileLength: 2500.0,
            cellVariations: [
                {
                    probability: 0.4,
                    model: 'assets/farm01.gltf',
                    jitter: 0.9,
                    randomRotation: true
                },
                {
                    probability: 0.25,
                    model: 'lib:cropGreen',
                    jitter: 1.2,
                    randomRotation: false
                },
                {
                    probability: 0.25,
                    model: 'lib:cropYellow',
                    jitter: 1.2,
                    randomRotation: false
                },
                {
                    probability: 0.05,
                    model: 'lib:cropOchre',
                    jitter: 0.8,
                    randomRotation: true
                },
                {
                    probability: 0.05,
                    model: 'lib:cropRed',
                    jitter: 0.8,
                    randomRotation: true
                }
            ]
        };
        const field1 = new SceneryField(this.models, new THREE.Box2().setFromCenterAndSize(new THREE.Vector2(0, 10000), new THREE.Vector2(80000, 10000)), fieldOptions);
        this.scene.add(field1);
        const field2 = new SceneryField(this.models, new THREE.Box2().setFromCenterAndSize(new THREE.Vector2(-10000, -10000), new THREE.Vector2(10000, 15000)), fieldOptions);
        this.scene.add(field2);

        this.addAirBase(this.scene, this.models);

        this.addRefinery(this.scene, this.models);

        const samradar = new GroundTargetEntity(this.models.getModel('assets/samradar01.glb'), 0, 'SAM Radar', 'Stosneehar');
        samradar.position.set(500, 0, -400);
        this.scene.add(samradar);

        const warehouse = new GroundTargetEntity(this.models.getModel('assets/hangar01.gltf'), undefined, 'Warehouse', 'Radlydd');
        warehouse.position.set(-16000, 0, 11000);
        warehouse.quaternion.setFromAxisAngle(UP, Math.PI / 2);
        this.scene.add(warehouse);

        this.scene.add(this.player);

        const cockpit = new CockpitEntity(this.player, this.playerCamera.main, this.targetCamera.main, this.mapCamera);
        this.cockpitEntities.push(cockpit);
        this.scene.add(cockpit);

        const hud = new HUDEntity(this.player);
        this.cockpitEntities.push(hud);
        this.scene.add(hud);

        const exteriorData = new ExteriorDataEntity(this.player);
        exteriorData.enabled = false;
        this.exteriorEntities.push(exteriorData);
        this.scene.add(exteriorData);
    }

    private addRefinery(scene: Scene, models: ModelManager) {
        const x = -1200;
        const z = 1500;
        const refinery = new GroundTargetEntity(models.getModel('assets/refinery_towers01.gltf'), 2, 'Oil Refinery', 'Radlydd');
        refinery.position.set(x, 0, z);
        scene.add(refinery);

        const depot01a = new StaticSceneryEntity(models.getModel('assets/refinery_depot01.gltf'), 2);
        depot01a.position.set(x, 0, z - 100);
        scene.add(depot01a);

        const depot01b = new StaticSceneryEntity(models.getModel('assets/refinery_depot01.gltf'), 2);
        depot01b.position.set(x, 0, z + 100);
        depot01b.quaternion.setFromAxisAngle(UP, Math.PI);
        scene.add(depot01b);

        const depot01c = new StaticSceneryEntity(models.getModel('assets/refinery_depot01.gltf'), 2);
        depot01c.position.set(x + 100, 0, z - 100);
        scene.add(depot01c);

        const depot02a = new StaticSceneryEntity(models.getModel('assets/refinery_depot02.gltf'), 2);
        depot02a.position.set(x - 150, 0, z - 50);
        scene.add(depot02a);

        const depot02b = new StaticSceneryEntity(models.getModel('assets/refinery_depot02.gltf'), 2);
        depot02b.position.set(x + 150, 0, z + 50);
        scene.add(depot02b);
    }

    private addAirBase(scene: Scene, models: ModelManager) {
        const hangarGround1 = new StaticSceneryEntity(models.getModel('lib:pavement'), 5);
        hangarGround1.position.set(1360, 0, -860);
        hangarGround1.scale.set(200, 1, 200);
        scene.add(hangarGround1);

        const hangarGround2 = new StaticSceneryEntity(models.getModel('lib:pavement'), 5);
        hangarGround2.position.set(1640, 0, -860);
        hangarGround2.scale.set(200, 1, 200);
        scene.add(hangarGround2);

        const runway = new GroundTargetEntity(models.getModel('assets/runway01.gltf'), 0, 'Airbase', 'Stosneehar');
        runway.position.set(1500, 0, -800);
        scene.add(runway);

        const hangar1 = new StaticSceneryEntity(models.getModel('assets/hangar01.gltf'));
        hangar1.position.set(1330, 0, -800);
        hangar1.quaternion.setFromAxisAngle(UP, Math.PI / 2);
        scene.add(hangar1);

        const hangar2 = new StaticSceneryEntity(models.getModel('assets/hangar01.gltf'));
        hangar2.position.set(1330, 0, -860);
        hangar2.quaternion.setFromAxisAngle(UP, Math.PI / 2);
        scene.add(hangar2);

        const hangar3 = new StaticSceneryEntity(models.getModel('assets/hangar01.gltf'));
        hangar3.position.set(1330, 0, -920);
        hangar3.quaternion.setFromAxisAngle(UP, Math.PI / 2);
        scene.add(hangar3);

        const hangar4 = new StaticSceneryEntity(models.getModel('assets/hangar01.gltf'));
        hangar4.position.set(1670, 0, -810);
        hangar4.quaternion.setFromAxisAngle(UP, Math.PI);
        scene.add(hangar4);

        const planes = [
            { p: new THREE.Vector3(1580, PLANE_DISTANCE_TO_GROUND, -840), r: Math.PI / 2 },
            { p: new THREE.Vector3(1580, PLANE_DISTANCE_TO_GROUND, -870), r: Math.PI / 2 },
            { p: new THREE.Vector3(1580, PLANE_DISTANCE_TO_GROUND, -900), r: Math.PI / 2 },
            { p: new THREE.Vector3(1580, PLANE_DISTANCE_TO_GROUND, -930), r: Math.PI / 2 },
        ];
        planes.forEach(p => {
            const plane = new StaticSceneryEntity(models.getModel('assets/f22.glb'));
            plane.position.copy(p.p);
            plane.quaternion.setFromAxisAngle(UP, p.r);
            scene.add(plane);

            const shadow = new StaticSceneryEntity(models.getModel('assets/f22_shadow.gltf'));
            shadow.position.copy(p.p).setY(0);
            shadow.quaternion.setFromAxisAngle(UP, p.r);
            scene.add(shadow);
        });

        const tower = new StaticSceneryEntity(models.getModel('assets/control01.gltf'));
        tower.position.set(1580, 0, -500);
        tower.quaternion.setFromAxisAngle(UP, -Math.PI / 2);
        scene.add(tower);
    }

    private randomPosOver(surface: THREE.Object3D<THREE.Event>, position: THREE.Vector3, spread: number): THREE.Vector3 {
        assertIsDefined(surface);
        let intersections: THREE.Intersection<THREE.Object3D<THREE.Event>>[] = [];
        const caster = new THREE.Raycaster();
        const p = UP.clone();
        const d = UP.clone().negate();
        const scaledSpread = spread / TERRAIN_SCALE;
        do {
            intersections.length = 0;
            p.x = Math.random() * scaledSpread - scaledSpread / 2;
            p.z = Math.random() * scaledSpread - scaledSpread / 2;
            caster.set(p, d);
            intersections = caster.intersectObject(surface, true);
        } while (intersections.length === 0);
        position.copy(p).setY(0).multiplyScalar(TERRAIN_SCALE);
        return position;
    }

    private getPalette(): Palette {
        return this.palettes[this.currentPalette];
    }
}
