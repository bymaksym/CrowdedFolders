import { describe, it } from 'node:test';

import { RuleTester } from '../../testing.ts';
import { scatteredFeature } from './scattered-feature.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

/** laboral-time-server (MEJORAS 214): `registro` starts names in five layer packages of one Spring app. */
const LABORAL = 'src/main/java/com/laboral/time';
const laboral = [
    `${LABORAL}/controller/RegistroHorarioController.java`,
    `${LABORAL}/controller/UsuarioController.java`,
    `${LABORAL}/dto/RegistroHorarioDto.java`,
    `${LABORAL}/dto/RegistroUsuarioConRol.java`,
    `${LABORAL}/model/RegistroHorario.java`,
    `${LABORAL}/model/Usuario.java`,
    `${LABORAL}/repository/RegistroHorarioRepository.java`,
    `${LABORAL}/service/RegistroHorarioService.java`,
    `${LABORAL}/service/impl/RegistroHorarioServiceImpl.java`,
    `${LABORAL}/Application.java`,
];

tester.run('scattered-feature', scatteredFeature, {
    valid: [
        {
            name: 'brocoders/nestjs-boilerplate: the layers are already inside the feature folder users/',
            files: [
                'src/users/infrastructure/persistence/relational/entities/user.entity.ts',
                'src/users/infrastructure/persistence/relational/mappers/user.mapper.ts',
                'src/users/infrastructure/persistence/relational/repositories/user.repository.ts',
                'src/users/infrastructure/persistence/document/entities/user.schema.ts',
                'src/users/infrastructure/persistence/document/mappers/user.mapper.ts',
                'src/users/infrastructure/persistence/document/repositories/user.repository.ts',
            ],
        },
        {
            name: 'a word in two layers is under the minimum of three',
            files: [`${LABORAL}/controller/UsuarioController.java`, `${LABORAL}/model/Usuario.java`],
        },
        {
            name: 'a folder that is not a layer does not count: utils/, config/',
            files: ['src/controller/OrderController.java', 'src/utils/OrderUtils.java', 'src/config/OrderConfig.java'],
        },
        {
            name: 'an ignored word',
            files: ['app/Models/Base.php', 'app/Services/BaseService.php', 'app/Repositories/BaseRepository.php'],
            options: { ignore: ['base'] },
        },
    ],
    invalid: [
        {
            name: 'laboral-time-server: registro in five layer folders, once, with every move',
            files: laboral,
            config: { naming: { folderCase: 'lower' } },
            errors: [
                {
                    folder: LABORAL,
                    key: 'registro',
                    measured: 5,
                    limit: 2,
                    message:
                        /^"registro" starts 6 module names across 5 layer folders \(controller\/, dto\/, model\/, repository\/, service\/\): a feature split by layer\. Package by feature: move them into src\/main\/java\/com\/laboral\/time\/registro\//u,
                    moves: [
                        {
                            from: `${LABORAL}/controller/RegistroHorarioController.java`,
                            to: `${LABORAL}/registro/RegistroHorarioController.java`,
                        },
                        {
                            from: `${LABORAL}/dto/RegistroHorarioDto.java`,
                            to: `${LABORAL}/registro/RegistroHorarioDto.java`,
                        },
                        {
                            from: `${LABORAL}/dto/RegistroUsuarioConRol.java`,
                            to: `${LABORAL}/registro/RegistroUsuarioConRol.java`,
                        },
                        {
                            from: `${LABORAL}/model/RegistroHorario.java`,
                            to: `${LABORAL}/registro/RegistroHorario.java`,
                        },
                        {
                            from: `${LABORAL}/repository/RegistroHorarioRepository.java`,
                            to: `${LABORAL}/registro/RegistroHorarioRepository.java`,
                        },
                        {
                            from: `${LABORAL}/service/RegistroHorarioService.java`,
                            to: `${LABORAL}/registro/RegistroHorarioService.java`,
                        },
                    ],
                },
            ],
        },
        {
            name: 'immich-app/immich: NestJS layers by folder, plural, one problem per feature',
            files: [
                'server/src/controllers/album.controller.ts',
                'server/src/dtos/album.dto.ts',
                'server/src/repositories/album.repository.ts',
                'server/src/services/album.service.ts',
                'server/src/services/album.service.spec.ts',
                'server/src/controllers/asset.controller.ts',
                'server/src/services/asset.service.ts',
            ],
            errors: [
                {
                    folder: 'server/src',
                    key: 'album',
                    measured: 4,
                    files: [
                        'server/src/controllers/album.controller.ts',
                        'server/src/dtos/album.dto.ts',
                        'server/src/repositories/album.repository.ts',
                        'server/src/services/album.service.spec.ts',
                        'server/src/services/album.service.ts',
                    ],
                },
            ],
        },
        {
            name: 'koel/koel: Laravel writes its folders in PascalCase, and an existing folder is moved into',
            files: [
                'app/Models/Song.php',
                'app/Repositories/SongRepository.php',
                'app/Services/SongService.php',
                'app/Song/.gitkeep',
            ],
            config: { naming: { folderCase: 'pascal' } },
            errors: [
                {
                    folder: 'app',
                    key: 'song',
                    moves: [
                        { from: 'app/Models/Song.php', to: 'app/Song/Song.php' },
                        { from: 'app/Repositories/SongRepository.php', to: 'app/Song/SongRepository.php' },
                        { from: 'app/Services/SongService.php', to: 'app/Song/SongService.php' },
                    ],
                },
            ],
        },
        {
            name: 'two layers with a file of the same name: the second keeps its place, and says why',
            files: ['src/model/Order.java', 'src/entity/Order.java', 'src/service/OrderService.java'],
            errors: [
                {
                    folder: 'src',
                    key: 'order',
                    message:
                        /src\/model\/Order\.java stays where it is: another module goes to src\/order\/Order\.java\./u,
                },
            ],
        },
        {
            name: 'the tests of a Java tree go with it (naming.mirrors), reported once',
            files: [
                'src/main/java/a/controller/OrderController.java',
                'src/main/java/a/service/OrderService.java',
                'src/main/java/a/repository/OrderRepository.java',
                'src/test/java/a/controller/OrderControllerTest.java',
                'src/test/java/a/service/OrderServiceTest.java',
                'src/test/java/a/repository/OrderRepositoryTest.java',
            ],
            config: { naming: { mirrors: ['**/src/main/java/** => **/src/test/java/**'] } },
            errors: [
                {
                    folder: 'src/main/java/a',
                    key: 'order',
                    message: /Their tests in src\/test\/java\/a go the same way/u,
                    moves: [
                        {
                            from: 'src/main/java/a/controller/OrderController.java',
                            to: 'src/main/java/a/order/OrderController.java',
                        },
                        {
                            from: 'src/main/java/a/repository/OrderRepository.java',
                            to: 'src/main/java/a/order/OrderRepository.java',
                        },
                        {
                            from: 'src/main/java/a/service/OrderService.java',
                            to: 'src/main/java/a/order/OrderService.java',
                        },
                        {
                            from: 'src/test/java/a/controller/OrderControllerTest.java',
                            to: 'src/test/java/a/order/OrderControllerTest.java',
                        },
                        {
                            from: 'src/test/java/a/repository/OrderRepositoryTest.java',
                            to: 'src/test/java/a/order/OrderRepositoryTest.java',
                        },
                        {
                            from: 'src/test/java/a/service/OrderServiceTest.java',
                            to: 'src/test/java/a/order/OrderServiceTest.java',
                        },
                    ],
                },
            ],
        },
    ],
});
